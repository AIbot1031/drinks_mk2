import type {Drink,Filters} from './types';
import {eligible} from './recommend';

const normalized=(filters:Filters)=>JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?[...v].sort():v]).sort(([a],[b])=>String(a).localeCompare(String(b)))));
// The displayed filter snapshot and every selectable cup must match the validated request.
export function consumerContractMatches(expected:Filters,actual:Filters,results:Array<{drink:Drink;variants:Drink[]}>):boolean {
  return normalized(expected)===normalized(actual)&&results.every(row=>row.variants.length>0&&eligible(row.drink,expected)&&row.variants.every(v=>eligible(v,expected)));
}
