export const toppingTerms=['珍珠','波霸','椰果','布丁','仙草','燕麥','粉粿','奶蓋','果肉','冰淇淋','茶凍','芋圓','芋泥'];
const terms=toppingTerms.join('|');
const milkTeaTerms='(?:珍珠奶茶|奶茶)';
export function stripMilkTeaExclusions(text:string,exclude:()=>void=()=>{}):string {
  const prefix=new RegExp(`(?:不喜歡|不愛|討厭|不想喝|不想要|不喝|不能喝|不要|排除|別推薦)\\s*(?:再|喝|任何|給我)?\\s*${milkTeaTerms}`,'g');
  text=text.replace(prefix,(match,offset)=>{
    if(/(?:不是|並非|沒有)$/.test(text.slice(0,offset)))return match;
    if(new RegExp(`^的(?:${terms}|甜度|糖|冰)`).test(text.slice(offset+match.length)))return match;
    exclude();return '';
  });
  return text.replace(new RegExp(`${milkTeaTerms}\\s*(?:我)?(?:先|也|都)?(?:不喜歡|不愛|不喝|不要|排除)(?:了)?(?=$|[，,。；;！!？?\\s])`,'g'),()=>{exclude();return '';});
}
export function milkTeaAllowedPattern():RegExp {
  return /取消(?:對)?奶茶(?:的)?排除|奶茶(?:現在)?可以(?:了)?|(?:可以|允許)喝奶茶|不再排除奶茶/g;
}
export function milkTeaRetrievalQuery(text:string,excluded:boolean):string {
  text=stripMilkTeaExclusions(normalizeDrinkLanguage(text));
  if(excluded){
    text=text.replace(/珍珠奶茶|奶茶|奶綠|奶青|奶烏龍/g,'');
    if(/^(?:[，,。；;\s]|我|但是|可是|而且|但|想喝|要喝|想要|今天|這次)+$/.test(text))text='';
  }
  return text.replace(/^[，,。；;\s]+|[，,。；;\s]+$/g,'')
    .replace(/^(?:我)?(?:今天|這次)?(?:想喝|要喝|想要喝|想要|想|要|幫我找)?$/,'').trim();
}
// Shorthand is normalized before both rule parsing and legacy-state repair.
export function normalizeDrinkLanguage(text:string):string {
  // A stated fresh/plant milk choice can express the same choice as "no creamer".
  if(/鮮奶|植物奶|燕麥奶|豆奶|拿鐵|歐蕾/.test(text))text=text.replace(/(?:不要|不喝|不含|不加)奶精/g,'');
  text=text.replace(new RegExp(`不要\\s*((?:${terms})(?:\\s*(?:和|跟|及|與|、)\\s*(?:${terms}))+ )`.replace('+ )','+)'),'g'),(_phrase,list)=>list.split(/\s*(?:和|跟|及|與|、)\s*/).map((t:string)=>`不要${t}`).join('，'));
  text=text.replace(/珍奶/g,'珍珠奶茶').replace(/粉圓/g,'珍珠')
    .replace(/(紅茶|綠茶|青茶|烏龍茶|金萱茶|普洱茶|蕎麥茶)(?:拿鐵|歐蕾)/g,'$1鮮奶')
    .replace(new RegExp(`(?:不喜歡|不愛|討厭|不想要|不想加|不要有|不要加|不用加|別加|去掉|不放|不加|排除|不要)\\s*(${terms}|珍(?=$|[，,。；;！!？?\\s]|但|然後|而且))`,'g'),(_,t)=>`不要${t==='珍'?'珍珠':t}`);
  return text.replace(new RegExp(`不要\\s*((?:${terms})(?:\\s*(?:和|跟|及|與|、)\\s*(?:${terms}))+)`,'g'),(_phrase,list)=>list.split(/\s*(?:和|跟|及|與|、)\s*/).map((t:string)=>`不要${t}`).join('，'));
}
export function stripToppingExclusions(text:string,onExclude?:(t:string)=>void):string {
  return text.replace(new RegExp(`不要\\s*(${terms})`,'g'),(_,t)=>{onExclude?.(t);return '';});
}
export function sameTopping(a:string,b:string):boolean {
  return a===b||(['珍珠','波霸'].includes(a)&&['珍珠','波霸'].includes(b));
}
