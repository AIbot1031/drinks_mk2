import {validateInput} from './understand';
import type {ConversationState} from './conversation';
import type {Filters} from './types';
import {numericConditions,exclusiveKeys,numericAcknowledgement,flavorQuery} from './numeric-language';
import {normalizeDrinkLanguage,sameTopping,milkTeaRetrievalQuery,milkTeaAllowedPattern,requiredToppings,setRequiredToppings,toppingTerms} from './drink-language';

export function applyLlmUnderstanding(turn:{state:ConversationState;input:ReturnType<typeof validateInput>;message:string},value:unknown,brands:string[],tea:string[],toppings:string[]){
  const r=value as {action?:unknown;query?:unknown;filters?:unknown;assistantMessage?:unknown;modelVersion?:unknown;durationMs?:unknown}|null;
  if(!r||typeof r.query!=='string'||r.query.length>300||!r.filters||typeof r.filters!=='object'||Array.isArray(r.filters)
    ||typeof r.modelVersion!=='string'||!/^qwen(?:3-8b|3\.5-9b)-4bit-/.test(r.modelVersion)||typeof r.durationMs!=='number'||(!Number.isFinite(r.durationMs)||r.durationMs<0))return null;
  if(r.action!==undefined&&!['recommend','clarify'].includes(r.action as string))return null;
  if(r.action!=='clarify'&&Object.keys(r.filters).some(k=>!['brand','excludedBrands','excludedToppings','milkTea','milk','tea','topping','toppings','maxPrice','maxCalories','maxCaffeine','priceExclusive','caloriesExclusive','caffeineExclusive'].includes(k)))return null;
  let f:Filters;try{f=validateInput({query:r.query,filters:r.action==='clarify'?turn.state.filters:r.filters}).filters;}catch{return null;}
  if((f.brand&&!brands.includes(f.brand))||f.excludedBrands?.some(b=>!brands.includes(b))||(f.tea&&!tea.includes(f.tea))||requiredToppings(f).some(t=>!toppings.includes(t)))return null;
  const filters={...turn.state.filters};
  // Model numbers must agree with a field-specific, explicit request.
  const numeric=numericConditions(turn.message);
  for(const field of numeric.resolved){
    if(f[field]!==undefined&&f[field]===numeric.updates[field]){filters[field]=f[field];filters[exclusiveKeys[field]]=numeric.updates[exclusiveKeys[field]];}
  }
  const normalized=normalizeDrinkLanguage(turn.message);
  const allowsMilkTea=milkTeaAllowedPattern().test(turn.message);
  const negative=(term:string)=>new RegExp(`(?:不要|不想要|不喜歡|不愛|討厭|排除|不喝|不加|別加)\\s*${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`).test(normalized);
  filters.excludedBrands=[...new Set([...(filters.excludedBrands??[]),...(f.excludedBrands??[]).filter(negative)])];
  filters.excludedToppings=[...new Set([...(filters.excludedToppings??[]),...(f.excludedToppings??[]).filter(t=>negative(t)||(['珍珠','波霸'].includes(t)&&negative(t==='珍珠'?'波霸':'珍珠')))])];
  setRequiredToppings(filters,requiredToppings(filters).filter(t=>!filters.excludedToppings?.some(x=>sameTopping(x,t))));
  const allowsBrand=f.brand&&new RegExp(`${f.brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:現在)?可以`).test(turn.message);
  if(f.brand&&!allowsBrand&&!filters.excludedBrands.includes(f.brand)&&(!filters.brand||turn.message.includes(f.brand)))filters.brand=f.brand;
  if(filters.brand&&filters.excludedBrands.includes(filters.brand))delete filters.brand;
  if(f.milk==='fresh'&&/鮮奶|牛奶/.test(turn.message)&&!/(?:不要|不喝)(?:鮮奶|牛奶)/.test(turn.message))filters.milk='fresh';
  if(f.milk==='plant'&&/植物奶|燕麥奶|豆奶/.test(turn.message))filters.milk='plant';
  if(f.milk==='none'&&/(?:不要|不喝)(?:奶(?!茶|綠|青|烏龍|蓋|精)|乳)|純茶|純紅茶|純綠茶/.test(turn.message))filters.milk='none';
  if(f.milk==='any'&&/奶(?:類)?(?:不限|都可以)/.test(turn.message))filters.milk='any';
  if(f.tea&&turn.message.includes(f.tea))filters.tea=f.tea;
  const modelToppings=requiredToppings(f).filter(t=>normalized.includes(t)&&!filters.excludedToppings?.some(x=>sameTopping(x,t))&&!negative(t)&&!new RegExp(`${t}(?:現在)?可以`).test(turn.message));
  setRequiredToppings(filters,[...requiredToppings(filters),...modelToppings]);
  if(f.milkTea===true&&filters.milkTea!==false&&!allowsMilkTea&&filters.milk!=='none'&&/奶茶|珍奶/.test(turn.message))filters.milkTea=true;
  else if(f.milkTea===false&&/(?:換|改|純茶|咖啡)/.test(turn.message))filters.milkTea=false;
  const conditionEdit=numeric.onlyConditions&&!!(turn.state.query||turn.state.filters.tea||turn.state.filters.milkTea);
  const action=conditionEdit?'recommend':filters.milkTea===false&&!turn.state.query&&!turn.state.guard?'clarify':r.action;
  const state:ConversationState={...turn.state,query:conditionEdit||action==='clarify'||allowsMilkTea||(filters.milk==='none'&&filters.milkTea===false)?turn.state.query:r.query,filters};
  const flavor=(query:string)=>flavorQuery(milkTeaRetrievalQuery(query,filters.milkTea===false).replace(new RegExp(toppingTerms.join('|'),'g'),''));
  state.query=flavor(state.query)||flavor(turn.state.query);
  if(action==='clarify')state.clarification=state.guard.startsWith('未辨識條件：')?'topping-exclusion':'taste';
  else delete state.clarification;
  const input=validateInput({...turn.input,query:state.guard||state.query,filters});
  // Only use short acknowledgements, never model-created drink/ingredient facts.
  let ack=typeof r.assistantMessage==='string'&&r.assistantMessage.length<=160&&!/保證|安全|過敏|熱量|咖啡因|價格|\d|mg|kcal/.test(r.assistantMessage)?r.assistantMessage:'已理解你的口味與篩選條件。';
  if(action!=='clarify'){
    const labels=[filters.milkTea?'奶茶':filters.tea,filters.milkTea===false?'不喝奶茶':undefined,filters.milk==='fresh'?'鮮奶':filters.milk==='plant'?'植物奶':filters.milk==='none'?'無奶標記':undefined,requiredToppings(filters).length?`含${requiredToppings(filters).join('、')}`:undefined,
      filters.excludedToppings.length?`不加${filters.excludedToppings.join('、')}`:undefined,
      filters.excludedBrands.length?`排除${filters.excludedBrands.join('、')}`:undefined].filter(Boolean);
    ack=labels.length?`已套用條件：${labels.join('；')}。`:'已理解你的口味與篩選條件。';
  }
  if(conditionEdit)ack=numericAcknowledgement(filters);
  if(action==='clarify'&&ack==='已理解你的口味與篩選條件。')ack=state.clarification==='topping-exclusion'?'請問你想排除哪一種配料？':filters.milkTea===false?'不喝奶茶的話，你想喝純茶、果汁，還是其他口味？':'你想喝清爽茶類，還是濃郁奶茶？';
  if(action==='clarify'&&filters.milkTea===false&&state.clarification==='taste')ack='已設定不喝奶茶，你想喝純茶、果汁，還是其他口味？';
  return {state,input,ack,clarify:action==='clarify',modelVersion:r.modelVersion,durationMs:r.durationMs};
}
