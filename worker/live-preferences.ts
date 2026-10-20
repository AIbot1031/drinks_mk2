import type {Drink} from './types';
import {productKey} from './products';

export const LIVE_PREFERENCE_CONFIG={likeWeight:0.22,dislikeWeight:0.10,evidencePrior:2} as const;
/** Current snapshots only: cancellations remove evidence, cup variants never multiply it. */
export function livePreferenceScorer(drinks:Drink[],likedIds:string[],dislikedIds:string[],sharedById?:ReadonlyMap<string,Drink>){
  if(!likedIds.length&&!dislikedIds.length)return {active:false,likedCount:0,dislikedCount:0,score:(_d:Drink)=>({like:0,dislike:0,adjustment:0})};
  const byId=sharedById??new Map(drinks.map(d=>[d.id,d]));
  const unique=(ids:string[])=>[...new Map(ids.flatMap(id=>byId.has(id)?[[productKey(byId.get(id)!),byId.get(id)!] as const]:[])).values()];
  const features=(d:Drink)=>new Set([...d.tea.map(v=>`tea:${v}`),...d.milk.map(v=>`milk:${v}`),...d.toppings.map(v=>`topping:${v}`),
    ...['清爽','濃郁','果香','酸甜','奶香','嚼勁','回甘','花香'].filter(v=>d.taste.includes(v)).map(v=>`taste:${v}`)]);
  const profile=(items:Drink[])=>{
    const counts=new Map<string,number>();
    for(const d of items)for(const f of features(d))counts.set(f,(counts.get(f)??0)+1);
    // Saturating support / total evidence keeps every feature in [0,1].
    return new Map([...counts].map(([f,count])=>[f,count/(items.length+LIVE_PREFERENCE_CONFIG.evidencePrior)]));
  };
  const liked=unique(likedIds),disliked=unique(dislikedIds),positive=profile(liked),negative=profile(disliked);
  const affinity=(fs:Set<string>,p:Map<string,number>)=>fs.size?[...fs].reduce((sum,f)=>sum+(p.get(f)??0),0)/fs.size:0;
  return {active:liked.length+disliked.length>0,likedCount:liked.length,dislikedCount:disliked.length,score(d:Drink){
    const fs=features(d),like=affinity(fs,positive),dislike=affinity(fs,negative);
    return {like,dislike,adjustment:LIVE_PREFERENCE_CONFIG.likeWeight*like-LIVE_PREFERENCE_CONFIG.dislikeWeight*dislike};
  }};
}
