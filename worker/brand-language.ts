const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Explicit dislike of a brand is an exclusion; dislike of one drink is not.
export function stripBrandExclusions(text:string,brands:string[],exclude:(brand:string)=>void){
  if(!brands.length)return text;
  const brand=`(?:${[...brands].sort((a,b)=>b.length-a.length).map(escape).join('|')})`;
  // Brand-first wording must not turn an exclusion into a chosen brand.
  text=text.replace(new RegExp(`(${brand})\\s*(?:先|也|都)?(?:排除|不要|不喝|不推薦)`,'g'),(_,b)=>{exclude(b);return '';});
  const pattern=new RegExp(`(?:不喜歡|不愛|討厭|不要|排除|不喝|不想喝|不推薦)\\s*${brand}(?:\\s*[和跟及與、]\\s*${brand})*`,'g');
  return text.replace(pattern,(match:string,offset:number)=>{
    if(/(?:不是|並非|沒有)$/.test(text.slice(0,offset)))return match;
    const suffix=text.slice(offset+match.length);
    if(/^\s*(?:的|家)(?!品牌|店|飲料都|所有飲料|全部)/.test(suffix))return match;
    for(const b of brands)if(match.includes(b))exclude(b);
    return '';
  });
}
