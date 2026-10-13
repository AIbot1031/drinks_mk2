import {normalizeDrinkLanguage, stripToppingExclusions, sameTopping, toppingTerms} from './drink-language';
import {understand, validateInput} from './understand';
import type {Filters} from './types';

export type ConversationState = {query: string; filters: Filters; guard: string; clarification?:'topping-exclusion'|'taste'};
const escape = (s:string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function conversationTurn(body: unknown, brands: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('對話格式有誤');
  const v = body as Record<string,unknown>;
  if (typeof v.message !== 'string' || !v.message.trim() || v.message.length > 300) throw new Error('每則訊息須為 1 至 300 字');
  const message = v.message.trim();
  const prior = v.state as Partial<ConversationState> | undefined;
  if (prior !== undefined && (!prior || typeof prior !== 'object' || Array.isArray(prior))) throw new Error('對話條件格式有誤');
  if (prior?.guard !== undefined && (typeof prior.guard !== 'string' || prior.guard.length > 300)) throw new Error('對話限制格式有誤');
  if(prior?.clarification!==undefined&&!['topping-exclusion','taste'].includes(prior.clarification))throw new Error('追問狀態格式有誤');
  const validated = validateInput({query:prior?.query ?? '',filters:prior?.filters ?? {}});
  const reset = /^(?:重新開始|重設|清除條件|換個話題)[！!。\s]*$/.test(message);
  const state:ConversationState = reset ? {query:'',filters:{},guard:''} : {query:validated.query,filters:{...validated.filters},guard:prior?.guard ?? '',clarification:prior?.clarification};
  // Repair old preference-only guards without clearing genuine allergy restrictions.
  if(state.guard.startsWith('忌口：')||state.guard.startsWith('未辨識條件：')){
    const rest=stripToppingExclusions(normalizeDrinkLanguage(state.guard.replace(/^(?:忌口|未辨識條件)：/,'')));
    if(!/(過敏|乳糖不耐|忌口|不要|不加|不放|排除|不喝)/.test(rest)){
      state.guard='';if(rest.includes('奶茶'))state.filters.milkTea=true;
      if(!state.query)state.query=rest.replace(/珍珠/g,'').trim();
    }
  }
  const next = /^(?:再推薦(?:幾杯)?|再看一批|換一批|還有嗎|其他選擇)[？?！!。\s]*$/.test(message);
  if (reset || next) return {state,next,reset,warnings:[],input:validateInput({query:state.guard || state.query,filters:state.filters}), message};
  let cleaned = normalizeDrinkLanguage(message).replace(/(預算|價格|價錢|熱量|卡路里|咖啡因)(?:\s*(?:改成|改為|改到|調成|調到|設成))\s*/g,'$1 ');
  if(state.clarification==='topping-exclusion'&&toppingTerms.includes(cleaned.trim()))cleaned='不要'+cleaned.trim();
  const excluded = new Set(state.filters.excludedBrands ?? []);
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
  const fresh = understand(validateInput({query:cleaned}),brands);
  if(state.clarification==='topping-exclusion'&&state.guard.startsWith('未辨識條件：')&&fresh.filters.excludedToppings?.length){state.guard='';delete state.clarification;}
  for (const [key,value] of Object.entries(fresh.filters)) {
    if (key!=='excludedBrands'&&key!=='excludedToppings' && value!==undefined) Object.assign(state.filters,{[key]:value});
  }
  state.filters.excludedToppings=[...new Set([...(state.filters.excludedToppings??[]),...(fresh.filters.excludedToppings??[])])];
  if(state.filters.topping&&state.filters.excludedToppings.some(t=>sameTopping(t,state.filters.topping!)))delete state.filters.topping;
  for (const [phrase,key] of [['預算','maxPrice'],['價格','maxPrice'],['熱量','maxCalories'],['咖啡因','maxCaffeine'],['品牌','brand'],['茶種','tea'],['配料','topping']] as const) {
    if (new RegExp(`${phrase}(?:改成|改為)?(?:不限|都可以|不限制)`).test(message)) delete state.filters[key];
  }
  if (/奶類(?:改成|改為)?(?:不限|都可以)|奶都可以/.test(message)) state.filters.milk='any';
  const supportedCleaned=stripToppingExclusions(cleaned);
  const unsupportedNegative = /(?:不要|排除|不喝|不推薦)/.test(supportedCleaned) && !/(?:不要|不喝)(?:奶類|乳製品|奶|乳)(?=$|[，。\s])|不要咖啡因/.test(supportedCleaned);
  if (fresh.blocked || unsupportedNegative){state.guard=unsupportedNegative ? `未辨識條件：${message}` : cleaned;if(unsupportedNegative)state.clarification='topping-exclusion';}
  if (fresh.preferences.length) state.query=fresh.preferences.join('、');
  else if (!Object.entries(fresh.filters).some(([k,val])=>k!=='excludedBrands'&&val!==undefined) && !/(?:不限|都可以|取消|不要|排除)/.test(message)) state.query=cleaned;
  // Strip known filter phrases before retaining initial free text, so later caps can increase.
  if (!state.query && !state.guard) {
    let q=stripToppingExclusions(cleaned).replace(/(?:預算|價格|價錢|熱量|卡路里|咖啡因)\s*(?:不超過|最多|上限|低於|小於)?\s*\d+(?:\.\d+)?\s*(?:元|塊|mg|kcal)?/g,'');
    q=q.replace(/\d+(?:\.\d+)?\s*(?:元|塊)\s*(?:以下|以內|內)|晚上|睡前/g,'');
    q=q.replace(/(?:不要|不含|不加|不能喝|不喝|無)[^，。\s]{0,3}(?:奶|乳)|(?:無|不含|不要|低)咖啡因|低(?:热量|熱量|卡)|植物奶|燕麥奶|豆奶|鮮奶|(?:預算|價格|熱量|咖啡因|品牌|茶種|配料|奶類)(?:改成|改為)?(?:不限|都可以|不限制)/g,'');
    for (const label of ['紅茶','綠茶','青茶','烏龍茶','金萱茶','普洱茶','蕎麥茶','珍珠','椰果','布丁','仙草','燕麥','粉粿']) q=q.replaceAll(label,'');
    for (const b of brands) q=q.replace(new RegExp(escape(b),'g'),'');
    state.query=q.replace(/(?:但是|可是|而且|但)[，\s]*$/,'').replace(/^[，\s]+|[，\s]+$/g,'');
  }
  return {state,next:false,reset:false,warnings:fresh.warnings,input:validateInput({query:state.guard || state.query,filters:state.filters}),message};
}
