import type {Drink} from './types';
export const productKey=(d:Drink)=>JSON.stringify([d.brand,d.name]);
export type PreferenceIds={likedIds:string[];dislikedIds:string[]};
/** One catalogue representative per brand/name; never fan out preference events. */
export function createProductPreferences(drinks:Drink[]){
  const groups=groupProducts(drinks),byId=new Map(drinks.map(d=>[d.id,d]));
  const canonicalIds=Object.fromEntries([...groups.values()].flatMap(variants=>variants.map(d=>[d.id,variants[0].id])));
  const canonicalMapping=JSON.stringify(canonicalIds);
  const normalize=(prefs:PreferenceIds):PreferenceIds=>{
    const ids=(values:string[])=>[...new Set(values.flatMap(id=>byId.has(id)?[canonicalIds[id]]:[]))].sort();
    const dislikedIds=ids(prefs.dislikedIds),disliked=new Set(dislikedIds);
    return {likedIds:ids(prefs.likedIds).filter(id=>!disliked.has(id)),dislikedIds};
  };
  const feedback=(prefs:PreferenceIds)=>{
    const normalized=normalize(prefs);
    return {version:2,liked:Object.fromEntries(normalized.likedIds.map(id=>[id,byId.get(id)!])),disliked:normalized.dislikedIds,
      dislikedProducts:Object.fromEntries(normalized.dislikedIds.map(id=>{const d=byId.get(id)!;return [id,{id,brand:d.brand,name:d.name}];}))};
  };
  return {normalize,feedback,canonicalMapping};
}
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
