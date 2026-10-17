const text=(tag,value,cls='')=>{const n=document.createElement(tag);n.textContent=value;n.className=cls;return n;};
export function appendAlternatives(target,value,card){
 if(!value.alternativeNotice)return;
 const section=text('section','','nearby-section');section.setAttribute('aria-label','接近選擇，未完全符合原條件');
 section.append(text('h3',value.alternatives?.length?'接近的選擇，先看看差在哪':'保留重要限制，這次不勉強湊數'),text('p',value.alternativeNotice,'nearby-notice'));
 if(value.alternatives?.length){section.append(text('p','原本的條件沒有更改。以下保留預算、熱量、咖啡因、奶類、不喜歡與排除限制，僅提供品牌、茶種、奶茶或配料的替代參考。','field-help'));
 const list=text('div','','nearby-cards');value.alternatives.forEach((r,i)=>{const item=text('div','','nearby-item'),differences=text('div','','nearby-differences');differences.append(text('strong','不完全符合'));for(const d of r.deviations)differences.append(text('span',d.message));item.append(differences,card(r.drink,i,r));list.append(item);});section.append(list);}
 target.append(section);
}
