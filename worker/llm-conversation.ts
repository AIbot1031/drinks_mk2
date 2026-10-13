import {validateInput} from './understand';
import type {ConversationState} from './conversation';
import type {Filters} from './types';

export function applyLlmUnderstanding(turn:{state:ConversationState;input:ReturnType<typeof validateInput>;message:string},value:unknown,brands:string[],tea:string[],toppings:string[]){
  const r=value as {action?:unknown;query?:unknown;filters?:unknown;assistantMessage?:unknown;modelVersion?:unknown;durationMs?:unknown}|null;
  if(!r||typeof r.query!=='string'||r.query.length>300||!r.filters||typeof r.filters!=='object'||Array.isArray(r.filters)
    ||typeof r.modelVersion!=='string'||!r.modelVersion.startsWith('qwen3-8b-4bit-')||typeof r.durationMs!=='number'||(!Number.isFinite(r.durationMs)||r.durationMs<0))return null;
  if(r.action!==undefined&&!['recommend','clarify'].includes(r.action as string))return null;
  if(r.action!=='clarify'&&Object.keys(r.filters).some(k=>!['brand','excludedBrands','excludedToppings','milkTea','milk','tea','topping','maxPrice','maxCalories','maxCaffeine'].includes(k)))return null;
  let f:Filters;try{f=validateInput({query:r.query,filters:r.action==='clarify'?turn.state.filters:r.filters}).filters;}catch{return null;}
  if((f.brand&&!brands.includes(f.brand))||f.excludedBrands?.some(b=>!brands.includes(b))||(f.tea&&!tea.includes(f.tea))||(f.topping&&!toppings.includes(f.topping)))return null;
  const filters={...turn.state.filters};
  // A cap can rise only when its value is explicitly stated for that field.
  for(const key of ['maxPrice','maxCalories','maxCaffeine'] as const){
    if(f[key]!==undefined){
      const pattern=key==='maxPrice'?/(?:預算|價格|價錢)[^\d，。]{0,12}(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|塊)/:key==='maxCalories'?/(?:熱量|卡路里)[^\d，。]{0,12}(\d+(?:\.\d+)?)/:/咖啡因[^\d，。]{0,12}(\d+(?:\.\d+)?)/;
      const explicit=turn.message.match(pattern);
      filters[key]=explicit&&Number(explicit[1]??explicit[2])===f[key]?f[key]:Math.min(filters[key]??Infinity,f[key]!);
    }
  }
  filters.excludedBrands=[...new Set([...(filters.excludedBrands??[]),...(f.excludedBrands??[])])];
  filters.excludedToppings=[...new Set([...(filters.excludedToppings??[]),...(f.excludedToppings??[])])];
  if(f.brand&&(!filters.brand||turn.message.includes(f.brand)))filters.brand=f.brand;
  if(f.milk&&/奶|乳/.test(turn.message))filters.milk=f.milk;
  if(f.tea&&turn.message.includes(f.tea))filters.tea=f.tea;
  if(f.topping&&turn.message.includes(f.topping)&&!filters.excludedToppings.includes(f.topping))filters.topping=f.topping;
  if(f.milkTea===true)filters.milkTea=true;
  else if(f.milkTea===false&&/(?:換|改|純茶|咖啡)/.test(turn.message))filters.milkTea=false;
  const state:ConversationState={...turn.state,query:r.action==='clarify'?turn.state.query:r.query,filters};
  if(r.action==='clarify')state.clarification=state.guard.startsWith('未辨識條件：')?'topping-exclusion':'taste';
  else delete state.clarification;
  const input=validateInput({...turn.input,query:state.guard||state.query,filters});
  // Only use short acknowledgements, never model-created drink/ingredient facts.
  let ack=typeof r.assistantMessage==='string'&&r.assistantMessage.length<=160&&!/保證|安全|過敏|熱量|咖啡因|價格|\d|mg|kcal/.test(r.assistantMessage)?r.assistantMessage:'已理解你的口味與篩選條件。';
  if(r.action==='clarify'&&ack==='已理解你的口味與篩選條件。')ack=state.clarification==='topping-exclusion'?'請問你想排除哪一種配料？':'你想喝清爽茶類，還是濃郁奶茶？';
  return {state,input,ack,clarify:r.action==='clarify',modelVersion:r.modelVersion,durationMs:r.durationMs};
}
