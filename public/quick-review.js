export function initQuickReview({api,session}){
 const $=s=>document.querySelector(s),list=$('#quick-review-reports'),status=$('#quick-review-status'),refresh=$('#refresh-quick-reports');
 const el=(tag,text,cls='')=>{const node=document.createElement(tag);node.textContent=text;node.className=cls;return node;};
 const labels={menu:'飲料／菜單資料',region:'地區／品牌資料',recommendation:'推薦結果',other:'其他建議'};
 let request=0;
 async function load(){
  const token=session(),current=++request;refresh.disabled=true;status.textContent='正在讀取回報…';
  try{
   const value=await api('/api/internal/feedback');if(token!==session()||current!==request)return;
   list.replaceChildren();status.textContent=`${value.results.length} 筆待處理回報（最多顯示最近 100 筆）。`;
   for(const row of value.results){
    const card=el('article','','quick-review-card');card.append(el('h3',labels[row.kind]||row.kind),el('small',new Date(row.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})),el('p',row.message));
    if(row.context.region)card.append(el('p',`地區：${row.context.region.city}${row.context.region.district}`));
    if(row.context.brand)card.append(el('p',`${row.context.brand}・${row.context.name}`));
    const note=el('p','');note.setAttribute('role','status');
    for(const [value,label] of [['resolved','標記已處理'],['rejected','關閉無效回報']]){
     const button=el('button',label,'secondary');button.type='button';
     button.onclick=async()=>{const buttons=[...card.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await api('/api/internal/feedback/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,status:value})});if(token===session())await load();}catch(error){if(token===session())note.textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}};
     card.append(button);
    }
    card.append(note);list.append(card);
   }
  }catch(error){if(token===session()&&current===request)status.textContent=error.message;}finally{if(token===session()&&current===request)refresh.disabled=false;}
 }
 refresh.onclick=load;return load;
}
