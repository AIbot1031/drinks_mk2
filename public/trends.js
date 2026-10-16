const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
const date=value=>value?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'尚未更新';
export function initTrends(){
 let data=null,selected='news',loading=false;
 const content=document.querySelector('#trends-content'),status=document.querySelector('#trends-status');
 function render(){
  for(const k of ['news','community','store'])document.querySelector(`#trend-${k}-tab`).setAttribute('aria-pressed',String(k===selected));
  content.replaceChildren();if(!data)return;
  if(selected==='store'){status.textContent='尚未接入店家銷量統計';const p=el('div','','trend-empty');p.append(el('span','第三種人氣','eyebrow'),el('h2','熱賣，需要店家的數字。'),el('p','目前沒有具統計期間與範圍的店家銷量資料。招牌推薦、新聞介紹或本站喜歡，都不會被當作店家銷量第一。'));content.append(p);return;}
  const snapshot=data[selected],attempt=data[selected+'Attempt'],isNews=selected==='news';
  status.textContent=attempt?.status==='failed'?`本次${isNews?'新聞來源':'本站統計'}更新未成功。${snapshot?'以下保留上次成功資料。':'目前沒有可顯示的有效排行。'}`:snapshot?`最近成功更新：${date(snapshot.generatedAt)}（台北時間）`:'尚無成功更新資料';
  if(data.stale[selected]&&snapshot)content.append(el('p','資料已超過八天，請先查看統計日期；這份資料不是最新一週。','trend-warning'));
  if(attempt?.status==='failed')content.append(el('p',`最近嘗試更新：${date(attempt.at)}。${isNews?'外部新聞來源暫時無法取得，這不代表沒有討論。':'暫時無法完成統計。'}`,'trend-warning'));
  const stats=el('div','','trend-stats');for(const [label,value] of [['統計期間',snapshot?`${date(snapshot.periodStart)} — ${date(snapshot.periodEnd)}`:'等待有效資料'],[isNews?'去重後新聞':'有效喜歡票數',snapshot?String(snapshot.sampleCount):'—'],[isNews?'有提及的品牌':'參與回饋帳號',snapshot?String(isNews?snapshot.rows.length:snapshot.participants):'—']]){const box=el('div');box.append(el('span',label),el('strong',value));stats.append(box);}content.append(stats);
  content.append(el('p',isNews?'依收錄新聞標題的品牌提及篇數排序，含正負面及可能的宣傳；不等於銷量或單杯人氣。':'依本週最後一次回饋仍為喜歡的帳號票數排序，大小杯合併。樣本較少，請搭配自己的口味參考。','trend-caption'));
  if(snapshot?.truncated)content.append(el('p','來源回傳達 250 筆上限，本榜只反映這批收錄資料，並非完整新聞總量。','trend-warning'));
  if(!snapshot?.rows.length){const empty=el('div','','trend-empty');empty.append(el('span','先有資料，再有排行。','eyebrow'),el('h2',isNews?'還沒有可核對的品牌排行':'本週還沒有有效喜歡票數'),el('p',isNews?'待來源更新成功並辨識到目錄品牌後，會顯示篇數與報導來源。也可以切換查看本站喜歡榜。':'到推薦或飲料圖鑑按「喜歡這杯」，可幫助個人化推薦；回饋會在每週更新時計入。'));content.append(empty);return;}
  const list=el('ol','','trend-list');for(const row of snapshot.rows.slice(0,20)){
   const item=el('li','','trend-row'),number=el('span',String(row.rank).padStart(2,'0'),'trend-rank'),body=el('div','','trend-row-body');
   body.append(el('span',isNews?'新聞中的品牌':row.brand,'eyebrow'),el('h2',row.name));
   const movement=row.previousRank===null?'尚無可比較的上期名次':row.previousRank===row.rank?'與上期同名次':`${row.previousRank>row.rank?'上升':'下降'} ${Math.abs(row.previousRank-row.rank)} 名`;
   body.append(el('p',movement,'trend-movement'));
   if(isNews&&row.sources?.length){const detail=el('details'),links=el('ul');detail.append(el('summary',`查看 ${row.sources.length} 篇來源`));row.sources.forEach((source,i)=>{let url;try{url=new URL(source.url);}catch{return;}if(!['https:','http:'].includes(url.protocol))return;const li=el('li'),a=el('a',`${source.domain} · ${date(source.seenAt)} ↗`);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);links.append(li);});detail.append(links);body.append(detail);}
   const votes=el('div','','trend-count');votes.append(el('strong',String(row.count)),el('span',isNews?'篇提及':'位喜歡'));item.append(number,body,votes);list.append(item);
  }content.append(list);
 }
 for(const k of ['news','community','store'])document.querySelector(`#trend-${k}-tab`).addEventListener('click',()=>{selected=k;render();});
 async function load(){if(loading)return;if(data)render();loading=true;status.textContent='正在讀取本週資料…';try{const response=await fetch('/api/trends');if(!response.ok)throw new Error();data=await response.json();document.querySelector('#trends-schedule').textContent=`${data.schedule}更新 · 下次排程 ${date(data.nextUpdate)}。`;render();}catch{status.textContent='排行資料暫時無法載入，請重新整理再試。';}finally{loading=false;}}
 return {load};
}
