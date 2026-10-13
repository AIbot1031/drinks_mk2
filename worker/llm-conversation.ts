import {validateInput} from './understand';
import type {ConversationState} from './conversation';
import type {Filters} from './types';

export function applyLlmUnderstanding(turn:{state:ConversationState;input:ReturnType<typeof validateInput>;message:string},value:unknown,brands:string[],tea:string[],toppings:string[]){
  const r=value as {query?:unknown;filters?:unknown;assistantMessage?:unknown;modelVersion?:unknown;durationMs?:unknown}|null;
  if(!r||typeof r.query!=='string'||r.query.length>300||!r.filters||typeof r.filters!=='object'||Array.isArray(r.filters)
    ||typeof r.modelVersion!=='string'||!r.modelVersion.startsWith('qwen3-8b-4bit-')||typeof r.durationMs!=='number'||(!Number.isFinite(r.durationMs)||r.durationMs<0))return null;
  let f:Filters;try{f=validateInput({query:r.query,filters:r.filters}).filters;}catch{return null;}
  if((f.brand&&!brands.includes(f.brand))||f.excludedBrands?.some(b=>!brands.includes(b))||(f.tea&&!tea.includes(f.tea))||(f.topping&&!toppings.includes(f.topping)))return null;
  const filters={...turn.state.filters};
  // Only tighten parsed caps; explicit increases have already been handled by rules.
  for(const key of ['maxPrice','maxCalories','maxCaffeine'] as const){
    if(f[key]!==undefined)filters[key]=Math.min(filters[key]??Infinity,f[key]!);
  }
  filters.excludedBrands=[...new Set([...(filters.excludedBrands??[]),...(f.excludedBrands??[])])];
  filters.excludedToppings=[...new Set([...(filters.excludedToppings??[]),...(f.excludedToppings??[])])];
  if(f.brand&&(!filters.brand||turn.message.includes(f.brand)))filters.brand=f.brand;
  if(f.milk&&/奶|乳/.test(turn.message))filters.milk=f.milk;
  if(f.tea&&turn.message.includes(f.tea))filters.tea=f.tea;
  if(f.topping&&turn.message.includes(f.topping)&&!filters.excludedToppings.includes(f.topping))filters.topping=f.topping;
  if(f.milkTea===true)filters.milkTea=true;
  const state={...turn.state,query:r.query,filters};
  const input=validateInput({...turn.input,query:state.guard||state.query,filters});
  // Only use short acknowledgements, never model-created drink/ingredient facts.
  const ack=typeof r.assistantMessage==='string'&&r.assistantMessage.length<=160&&!/保證|安全|過敏|熱量|咖啡因|價格|\d|mg|kcal/.test(r.assistantMessage)?r.assistantMessage:'已理解你的口味與篩選條件。';
  return {state,input,ack,modelVersion:r.modelVersion,durationMs:r.durationMs};
}
