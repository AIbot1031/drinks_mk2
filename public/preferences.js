// Product preferences are shared by every cup/region variant of brand + name.
export const productKey=d=>JSON.stringify([d.brand,d.name]);
export const likedProducts=feedback=>new Set(Object.values(feedback.liked).map(productKey));
export const dislikedProducts=feedback=>new Set(Object.values(feedback.dislikedProducts||{}).map(productKey));
export function removeLikedProduct(feedback,drink){
 for(const [id,d] of Object.entries(feedback.liked))if(productKey(d)===productKey(drink))delete feedback.liked[id];
}
export function removeDislikedProduct(feedback,drink){
 const key=productKey(drink),ids=new Set([drink.id,...Object.entries(feedback.dislikedProducts||{}).filter(([,d])=>productKey(d)===key).map(([id])=>id)]);
 feedback.disliked=feedback.disliked.filter(id=>!ids.has(id));
 for(const id of ids)delete feedback.dislikedProducts[id];
}
export function toggleProductPreference(feedback,drink,kind){
 const next=structuredClone(feedback);next.version=2;next.dislikedProducts||={};
 const key=productKey(drink),liked=likedProducts(next).has(key),disliked=dislikedProducts(next).has(key)||next.disliked.includes(drink.id);
 if(kind==='like'){
  if(liked)removeLikedProduct(next,drink);
  else{
   if(likedProducts(next).size>=200)throw new Error('最多收藏 200 款，請先取消部分收藏。');
   removeDislikedProduct(next,drink);next.liked[drink.id]={...drink,variants:undefined};
  }
 }else{
  if(disliked)removeDislikedProduct(next,drink);
  else{
   if(next.disliked.length>=200)throw new Error('最多記錄 200 款不喜歡的飲料。');
   removeLikedProduct(next,drink);next.disliked.push(drink.id);next.dislikedProducts[drink.id]={id:drink.id,brand:drink.brand,name:drink.name};
  }
 }
 return next;
}
