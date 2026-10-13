import type {Drink} from './types';
export const productKey=(d:Drink)=>JSON.stringify([d.brand,d.name]);
export function groupProducts(drinks:Drink[]) {
  const groups=new Map<string,Drink[]>();
  for(const drink of drinks){const key=productKey(drink);const list=groups.get(key)??[];list.push(drink);groups.set(key,list);}
  for(const list of groups.values())list.sort((a,b)=>(a.price??Infinity)-(b.price??Infinity)||a.id.localeCompare(b.id));
  return groups;
}
export function favoriteProducts(drinks:Drink[], ids:string[]) {
  const selected=new Set(ids);
  const keys=new Set(drinks.filter(d=>selected.has(d.id)).map(productKey));
  return [...groupProducts(drinks.filter(d=>keys.has(productKey(d)))).values()].map(variants=>({...variants[0],variants}));
}
