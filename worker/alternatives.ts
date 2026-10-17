import {eligible,isMilkTea,makeEngine,toppingMatches} from './recommend';
import {groupProducts,productKey} from './products';
import {requiredToppings} from './drink-language';
import {consumerContractMatches} from './consumer-contract';
import type {Drink,Filters,RecommendInput} from './types';
type Result=ReturnType<ReturnType<typeof makeEngine>['recommend']>['results'][number];
export type Deviation={field:'brand'|'tea'|'milkTea'|'toppings';message:string};
export type Alternative=Result&{deviations:Deviation[];actualFilters:Filters};
export function deviations(d:Drink,f:Filters):Deviation[]{
 const out:Deviation[]=[];
 if(f.brand&&d.brand!==f.brand)out.push({field:'brand',message:`不是指定品牌 ${f.brand}，這杯來自 ${d.brand}`});
 if(f.tea&&!d.tea.includes(f.tea))out.push({field:'tea',message:`未標記含指定茶種 ${f.tea}`});
 if(f.milkTea===true&&!isMilkTea(d))out.push({field:'milkTea',message:'這杯不是奶茶'});
 if(requiredToppings(f).length&&!toppingMatches(d,f))out.push({field:'toppings',message:`未含指定配料 ${requiredToppings(f).join('／')}`});
 return out;
}
function without(f:Filters,fields:Deviation['field'][]){const out={...f};for(const field of fields){if(field==='toppings'){delete out.topping;delete out.toppings;}else delete out[field];}return out;}
export function alternativesMatch(original:Filters,rows:Alternative[]){
 return rows.every(row=>{
  const ds=deviations(row.drink,original),expected=without(original,ds.map(d=>d.field));
  return ds.length>0&&JSON.stringify(ds)===JSON.stringify(row.deviations)&&consumerContractMatches(expected,row.actualFilters,[row])&&row.variants.every(v=>JSON.stringify(deviations(v,original))===JSON.stringify(ds));
 });
}
export function nearbyChoices(engine:ReturnType<typeof makeEngine>,drinks:Drink[],input:RecommendInput,response:ReturnType<ReturnType<typeof makeEngine>['recommend']>,needsClarification=false){
 const target=Math.min(5,input.limit),needed=Math.max(0,target-response.results.length);
 if(!needed||response.blocked||needsClarification)return {alternatives:[] as Alternative[],alternativeNotice:''};
 const f=response.filters,hard=without(f,['brand','tea','toppings',...(f.milkTea===true?['milkTea' as const]:[])]);
 const keys=new Set([...input.dislikedIds,...input.excludedIds,...response.results.map(r=>r.id)].flatMap(id=>engine.byId.has(id)?[productKey(engine.byId.get(id)!)]:[]));
 const pool=drinks.filter(d=>eligible(d,hard)&&!keys.has(productKey(d))&&deviations(d,f).length>0);
 const lexical=new Map(engine.lexical(input.query,pool).map(r=>[r.drink.id,r.score]));
 const penalty=(d:Drink)=>deviations(d,f).reduce((n,x)=>n+(x.field==='brand'?3:1),0);
 const candidates=[...groupProducts(pool).values()].map(variants=>{
  variants.sort((a,b)=>penalty(a)-penalty(b)||(lexical.get(b.id)??0)-(lexical.get(a.id)??0)||(a.price??Infinity)-(b.price??Infinity)||a.id.localeCompare(b.id));
  const best=variants[0],ds=deviations(best,f),actualFilters=without(f,ds.map(x=>x.field));
  const consistent=variants.filter(v=>JSON.stringify(deviations(v,f))===JSON.stringify(ds)).sort((a,b)=>(a.price??Infinity)-(b.price??Infinity)||a.id.localeCompare(b.id));
  const d=consistent[0];
  const message=ds.map(x=>x.message).join('；');
  return {id:d.id,name:d.name,brand:d.brand,rankSourceId:d.id,drink:d,variants:consistent,match_score:lexical.get(d.id)??0,reasoning:`接近選擇，未完全符合：${message}`,warning:'請先確認差異；預算、營養上限、奶類與排除條件仍保留。',confidence:'依條件差異及TF-IDF文字相近度排序，非模型校準機率',reasons:[message],ranks:{a:null,b:null},deviations:ds,actualFilters};
 }).sort((a,b)=>penalty(a.drink)-penalty(b.drink)||b.match_score-a.match_score||a.id.localeCompare(b.id));
 const alternatives=candidates.slice(0,needed);
 if(!alternativesMatch(f,alternatives))throw new Error('Alternative recommendation contract failed');
 const prefix=response.results.length?`完全符合條件的飲料目前只有 ${response.results.length} 款。`:'目前沒有完全符合所有條件的飲料。';
 return {alternatives,alternativeNotice:prefix+(alternatives.length?`另列出 ${alternatives.length} 款接近選擇，已逐杯標示未符合之處。`:'保留預算、營養、奶類及排除條件後，也沒有可提供的接近選擇。請自行調整條件，系統不會自動提高上限。')};
}
