import type {Drink} from './types';
export const productKey=(d:Drink)=>JSON.stringify([d.brand,d.name]);
export function groupProducts(drinks:Drink[]) {
  const groups=new Map<string,Drink[]>();
  for(const drink of drinks){const key=productKey(drink);const list=groups.get(key)??[];list.push(drink);groups.set(key,list);}
  for(const list of groups.values())list.sort((a,b)=>(a.price??Infinity)-(b.price??Infinity)||a.id.localeCompare(b.id));
  return groups;
}
