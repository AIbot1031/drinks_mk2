import {normalizeDrinkLanguage, stripToppingExclusions, stripMilkTeaExclusions, milkTeaRetrievalQuery, milkTeaAllowedPattern, sameTopping, toppingTerms,requiredToppings,setRequiredToppings} from './drink-language';
import {understand, validateInput} from './understand';
import {stripBrandExclusions} from './brand-language';
import type {Filters} from './types';
import {capFields,exclusiveKeys,numericConditions,numericAnswer,numericFollowUp,numericAcknowledgement,validateNumericQuestions,flavorQuery} from './numeric-language';
import type {NumericQuestion} from './numeric-language';

export type ConversationState = {query: string; filters: Filters; guard: string; clarification?:'topping-exclusion'|'taste'|'numeric';pendingCaps?:NumericQuestion[]};
const escape = (s:string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function conversationTurn(body: unknown, brands: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('對話格式有誤');
  const v = body as Record<string,unknown>;
  if (typeof v.message !== 'string' || !v.message.trim() || v.message.length > 300) throw new Error('每則訊息須為 1 至 300 字');
  const message = v.message.trim();
  const prior = v.state as Partial<ConversationState> | undefined;
  if (prior !== undefined && (!prior || typeof prior !== 'object' || Array.isArray(prior))) throw new Error('對話條件格式有誤');
  if (prior?.guard !== undefined && (typeof prior.guard !== 'string' || prior.guard.length > 300)) throw new Error('對話限制格式有誤');
  if(prior?.clarification!==undefined&&!['topping-exclusion','taste','numeric'].includes(prior.clarification))throw new Error('追問狀態格式有誤');
  const pendingCaps=validateNumericQuestions(prior?.pendingCaps);
  const validated = validateInput({query:prior?.query ?? '',filters:prior?.filters ?? {}});
  const reset = /^(?:重新開始|重設|清除條件|換個話題)[！!。\s]*$/.test(message);
  const state:ConversationState = reset ? {query:'',filters:{},guard:''} : {query:validated.query,filters:{...validated.filters},guard:prior?.guard ?? '',clarification:prior?.clarification,...(pendingCaps.length?{pendingCaps}:{})};
  const legacyNumeric=numericConditions(state.query,brands);
  for(const field of legacyNumeric.resolved)if(state.filters[field]===undefined&&legacyNumeric.updates[field]!==undefined){state.filters[field]=legacyNumeric.updates[field];state.filters[exclusiveKeys[field]]=legacyNumeric.updates[exclusiveKeys[field]];}
  if(legacyNumeric.questions.length)state.pendingCaps=validateNumericQuestions([...(state.pendingCaps??[]).filter(q=>!legacyNumeric.questions.some(n=>n.field===q.field)),...legacyNumeric.questions]);
  state.query=flavorQuery(state.query);
  stripMilkTeaExclusions(normalizeDrinkLanguage(state.query),()=>{state.filters.milkTea=false;});
  state.query=milkTeaRetrievalQuery(state.query,state.filters.milkTea===false);
  // Repair old preference-only guards without clearing genuine allergy restrictions.
  if(state.guard.startsWith('忌口：')||state.guard.startsWith('未辨識條件：')){
    const rest=stripMilkTeaExclusions(stripToppingExclusions(normalizeDrinkLanguage(state.guard.replace(/^(?:忌口|未辨識條件)：/,''))),()=>{state.filters.milkTea=false;});
    if(!/(過敏|乳糖不耐|忌口|不要|不加|不放|排除|不喝)/.test(rest)){
      state.guard='';if(rest.includes('奶茶'))state.filters.milkTea=true;
      if(!state.query)state.query=rest.replace(/珍珠/g,'').trim();
    }
  }
  state.query=milkTeaRetrievalQuery(state.query,state.filters.milkTea===false);
  const next = /^(?:再推薦(?:幾杯)?|再看一批|換一批|還有嗎|其他選擇)[？?！!。\s]*$/.test(message);
  if (reset || next) return {state,next,reset,followUp:!state.guard?numericFollowUp(state.pendingCaps??[]):undefined,constraintOnly:false,ack:undefined,warnings:[],input:validateInput({query:state.guard || state.query,filters:state.filters}), message};
  const numericMessage=state.pendingCaps?.length?numericAnswer(message,state.pendingCaps[0].field)??message:message;
  const numeric=numericConditions(numericMessage,brands);
  state.pendingCaps=[...(state.pendingCaps??[]).filter(q=>!numeric.resolved.has(q.field)&&!numeric.questions.some(n=>n.field===q.field)),...numeric.questions];
  if(!state.pendingCaps.length){delete state.pendingCaps;if(state.clarification==='numeric')delete state.clarification;}else state.clarification='numeric';
  let cleaned = normalizeDrinkLanguage(numeric.remainder).replace(/(預算|價格|價錢|熱量|卡路里|咖啡因)(?:\s*(?:改成|改為|改到|調成|調到|設成))\s*/g,'$1 ');
  cleaned=cleaned.replace(milkTeaAllowedPattern(),()=>{delete state.filters.milkTea;return '';});
  let excludesMilkTea=false;
  cleaned=stripMilkTeaExclusions(cleaned,()=>{excludesMilkTea=true;state.filters.milkTea=false;state.query=milkTeaRetrievalQuery(state.query,true);});
  if(!excludesMilkTea&&/奶茶/.test(cleaned)&&state.filters.milkTea===false){
    state.filters.milkTea=true;
    if(state.filters.milk==='none')delete state.filters.milk;
  }
  // Explicitly allowing an item removes its old exclusion without requiring it.
  for(const term of [...toppingTerms,...brands]){
    const allow=new RegExp(`(?:取消(?:對)?${escape(term)}(?:的)?排除|${escape(term)}(?:現在)?可以(?:了)?|(?:可以|允許)(?:加|喝|吃)?${escape(term)})`,'g');
    cleaned=cleaned.replace(allow,()=>{
      state.filters.excludedToppings=state.filters.excludedToppings?.filter(t=>!sameTopping(t,term));
      state.filters.excludedBrands=state.filters.excludedBrands?.filter(b=>b!==term);
      return '';
    });
  }
  const pureTea=/(?:純(?:紅茶|綠茶|青茶|烏龍茶|金萱茶|普洱茶|蕎麥茶)|純茶|(?:改喝|改成|換喝|換成)(?:純)?(?:紅茶|綠茶|青茶|烏龍茶|金萱茶|普洱茶|蕎麥茶))/.test(cleaned);
  if(pureTea){
    state.filters.milkTea=false;state.filters.milk='none';
    state.query=cleaned.match(/紅茶|綠茶|青茶|烏龍茶|金萱茶|普洱茶|蕎麥茶/)?.[0]??'純茶';
    cleaned=cleaned.replace(/(?:不要|不喝)奶茶/g,'不要奶');
  }
  if(state.clarification==='topping-exclusion'&&toppingTerms.includes(cleaned.trim()))cleaned='不要'+cleaned.trim();
  const excluded = new Set(state.filters.excludedBrands ?? []);
  cleaned=stripBrandExclusions(cleaned,brands,b=>excluded.add(b));
  if(state.filters.brand&&excluded.has(state.filters.brand))delete state.filters.brand;
  // Only consume an exclusion clause if every named item is a known brand.
  cleaned = cleaned.split(/[，,。；;]/).map(clause=>{
    const match = clause.trim().match(/^(?:我|請|然後|還有|也)?(?:不要|排除|不喝|不想喝|不推薦)\s*(.+)$/);
    if (!match) return clause;
    const matched = brands.filter(b=>match[1].includes(b));
    let rest = match[1];
    for (const b of matched) rest=rest.replaceAll(b,'');
    if (matched.length && !rest.replace(/[和跟及與、\s的品牌]/g,'')) {
      matched.forEach(b=>excluded.add(b));
      return '';
    }
    return clause;
  }).join('，');
  state.filters.excludedBrands=[...excluded];
  if (/取消(?:所有)?品牌排除|品牌都可以/.test(message)) state.filters.excludedBrands=[];
  const fresh = understand(validateInput({query:cleaned,filters:excludesMilkTea?{milkTea:false}:undefined}),brands);
  if(state.clarification==='topping-exclusion'&&state.guard.startsWith('未辨識條件：')&&fresh.filters.excludedToppings?.length){state.guard='';delete state.clarification;}
  for (const [key,value] of Object.entries(fresh.filters)) {
    if (!['excludedBrands','excludedToppings','topping','toppings'].includes(key) && value!==undefined) Object.assign(state.filters,{[key]:value});
  }
  const requested=requiredToppings(fresh.filters);
  if(requested.length)setRequiredToppings(state.filters,[...(/再加|也要|還要|加上|多加|再來|^(?:請|幫我)?加/.test(message)?requiredToppings(state.filters):[]),...requested]);
  for(const field of capFields)if(numeric.resolved.has(field)){state.filters[field]=numeric.updates[field];state.filters[exclusiveKeys[field]]=numeric.updates[exclusiveKeys[field]];}
  state.filters.excludedToppings=[...new Set([...(state.filters.excludedToppings??[]),...(fresh.filters.excludedToppings??[])])];
  setRequiredToppings(state.filters,requiredToppings(state.filters).filter(t=>!state.filters.excludedToppings?.some(x=>sameTopping(x,t))));
  for (const [phrase,key] of [['預算','maxPrice'],['價格','maxPrice'],['熱量','maxCalories'],['咖啡因','maxCaffeine'],['品牌','brand'],['茶種','tea'],['配料','topping']] as const) {
    if (new RegExp(`${phrase}(?:改成|改為)?(?:不限|都可以|不限制)`).test(message)) {delete state.filters[key];if(key==='topping')delete state.filters.toppings;}
  }
  if (/奶類(?:改成|改為)?(?:不限|都可以)|奶都可以/.test(message)) state.filters.milk='any';
  const supportedCleaned=stripToppingExclusions(cleaned);
  const unsupportedNegative = /(?:不要|排除|不喝|不推薦)/.test(supportedCleaned) && !/(?:不要|不喝)(?:奶類|乳製品|奶|乳)(?=$|[，。\s])|不要咖啡因/.test(supportedCleaned);
  if (fresh.blocked || unsupportedNegative){state.guard=unsupportedNegative ? `未辨識條件：${message}` : cleaned;if(unsupportedNegative)state.clarification='topping-exclusion';}
  if (fresh.preferences.length) state.query=fresh.preferences.join('、');
  else if (!numeric.onlyConditions && !Object.entries(fresh.filters).some(([k,val])=>k!=='excludedBrands'&&val!==undefined) && !/(?:不限|都可以|取消|不要|排除)/.test(message)) state.query=cleaned;
  // Strip known filter phrases before retaining initial free text, so later caps can increase.
  if (!state.query && !state.guard) {
    let q=stripToppingExclusions(cleaned).replace(/(?:預算|價格|價錢|熱量|卡路里|咖啡因)\s*(?:不超過|最多|上限|低於|小於)?\s*\d+(?:\.\d+)?\s*(?:元|塊|mg|kcal)?/g,'');
    q=q.replace(/\d+(?:\.\d+)?\s*(?:元|塊)\s*(?:以下|以內|內)|晚上|睡前/g,'');
    q=q.replace(/(?:不要|不含|不加|不能喝|不喝|無)[^，。\s]{0,3}(?:奶|乳)|(?:無|不含|不要|低)咖啡因|低(?:热量|熱量|卡)|植物奶|燕麥奶|豆奶|鮮奶|(?:預算|價格|熱量|咖啡因|品牌|茶種|配料|奶類)(?:改成|改為)?(?:不限|都可以|不限制)/g,'');
    for (const label of ['紅茶','綠茶','青茶','烏龍茶','金萱茶','普洱茶','蕎麥茶','珍珠','椰果','布丁','仙草','燕麥','粉粿']) q=q.replaceAll(label,'');
    for (const b of brands) q=q.replace(new RegExp(escape(b),'g'),'');
    state.query=q.replace(/(?:但是|可是|而且|但)[，\s]*$/,'').replace(/^[，\s]+|[，\s]+$/g,'');
  }
  if(/過敏|花生|堅果|乳糖不耐|麩質|忌口/.test(message))state.guard=normalizeDrinkLanguage(message);
  // Consumed ingredients live in filters, so later removal cannot revive them from old query text.
  if(requested.length||fresh.filters.excludedToppings?.length||/配料(?:改成|改為)?(?:不限|都可以|不限制)/.test(message)) {
    for(const topping of toppingTerms)state.query=state.query.replaceAll(topping,'');
  }
  state.query=flavorQuery(milkTeaRetrievalQuery(state.query,state.filters.milkTea===false));
  if(requested.length>1)state.query=state.query.replace(/^(?:我)?(?:想喝|要喝|想要|想|要)?(?:和|跟|及|與|、|，|,|\s)+/,'');
  if(!state.query&&state.filters.milkTea===false&&state.filters.tea)state.query=state.filters.tea;
  const constraintOnly=numeric.onlyConditions&&!!(state.query||state.filters.tea||state.filters.milkTea);
  return {state,next:false,reset:false,followUp:!state.guard?numericFollowUp(state.pendingCaps??[]):undefined,constraintOnly,ack:constraintOnly?numericAcknowledgement(state.filters):undefined,warnings:[...new Set([...numeric.warnings,...fresh.warnings])],input:validateInput({query:state.guard || state.query,filters:state.filters}),message};
}
