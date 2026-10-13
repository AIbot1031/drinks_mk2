export const toppingTerms=['珍珠','波霸','椰果','布丁','仙草','燕麥','粉粿','奶蓋','果肉','冰淇淋','茶凍','芋圓','芋泥'];
const terms=toppingTerms.join('|');
// Shorthand is normalized before both rule parsing and legacy-state repair.
export function normalizeDrinkLanguage(text:string):string {
  // A stated fresh/plant milk choice can express the same choice as "no creamer".
  if(/鮮奶|植物奶|燕麥奶|豆奶|拿鐵|歐蕾/.test(text))text=text.replace(/(?:不要|不喝|不含|不加)奶精/g,'');
  return text.replace(/珍奶/g,'珍珠奶茶').replace(/粉圓/g,'珍珠')
    .replace(/(紅茶|綠茶|青茶|烏龍茶|金萱茶|普洱茶|蕎麥茶)(?:拿鐵|歐蕾)/g,'$1鮮奶')
    .replace(new RegExp(`(?:不喜歡|不愛|討厭|不想要|不想加|不要有|不要加|不用加|別加|去掉|不放|不加|排除|不要)\\s*(${terms}|珍(?=$|[，,。；;！!？?\\s]|但|然後|而且))`,'g'),(_,t)=>`不要${t==='珍'?'珍珠':t}`);
}
export function stripToppingExclusions(text:string,onExclude?:(t:string)=>void):string {
  return text.replace(new RegExp(`不要\\s*(${terms})`,'g'),(_,t)=>{onExclude?.(t);return '';});
}
export function sameTopping(a:string,b:string):boolean {
  return a===b||(['珍珠','波霸'].includes(a)&&['珍珠','波霸'].includes(b));
}
