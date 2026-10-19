const text=(tag,value,cls='')=>{const n=document.createElement(tag);n.textContent=value;n.className=cls;return n;};
const dayEnd=at=>Math.floor((at+8*3600000)/86400000)*86400000+86400000-8*3600000;
const key=d=>JSON.stringify([d.brand,d.name]);
export function activeReports(records,now=Date.now()){
 return (Array.isArray(records)?records:[]).filter(r=>r&&Number.isFinite(r.reportedAt)&&['sold_out','not_sold'].includes(r.kind)&&now<(r.kind==='sold_out'?dayEnd(r.reportedAt):r.reportedAt+7*86400000));
}
export function initStoreControls({api,isBusy,setBusy,onChanged}){
 const $=s=>document.querySelector(s),storage='drinks-store-session-v1';
 let store=null,records={},reporting=false,locked=isBusy(),stores=[],attempts=new Map(),reporterId=crypto.randomUUID();
 try{const saved=JSON.parse(sessionStorage.getItem(storage)||'null');if(saved){store=saved.store&&['brand','name','address','id'].every(k=>typeof saved.store[k]==='string')?saved.store:null;records=saved.records&&typeof saved.records==='object'?saved.records:{};reporterId=/^[a-f0-9-]{36}$/.test(saved.reporterId)?saved.reporterId:reporterId;}}catch{}
 const save=()=>{try{sessionStorage.setItem(storage,JSON.stringify({store,records,reporterId}));}catch{$('#store-status').textContent='此分頁無法保存門市選擇，關閉後需重新選擇。';}};
 const current=()=>store?activeReports(records[store.id]||[]):[];
 function lock(value){locked=value;document.querySelectorAll('#store-custom-form input,#store-custom-form select,#store-custom-form button,#store-select,#store-search-form input,#store-search-form button,[data-store-report],[data-store-undo]').forEach(n=>{const turn=n.closest('.chat-message');n.disabled=value||reporting||!!turn&&turn!==turn.parentElement.lastElementChild;});}
 function render(){
  $('#store-status').textContent=store?`${store.brand} · ${store.name} · ${store.address}。${store.verified?'門市資料有公開來源；':'門市資料待查證；'}飲料供應須逐項確認。`:'未選門市；各門市供應可能不同。';
  $('#store-reports').replaceChildren();
  for(const r of current()){
   const row=text('div','','collection-actions'),button=text('button','解除本次排除','secondary');button.type='button';button.dataset.storeUndo=r.drinkId;
   button.onclick=async()=>{if(isBusy()||reporting)return;records[store.id]=current().filter(x=>key(x)!==key(r));save();render();await onChanged();};
   row.append(text('span',`${r.brand} · ${r.name}：${r.kind==='sold_out'?'今天售完':'菜單沒有'}（本次回報排除）`),button);$('#store-reports').append(row);
  }
  if(!current().length)$('#store-reports').append(text('p','目前這家門市沒有本次缺品排除。','field-help'));lock(locked);
 }
 async function search(){
  try{const value=await api('/api/stores?q='+encodeURIComponent($('#store-query').value));stores=value.results;
   const options=[text('option','不指定門市')];options[0].value='';
   for(const s of stores){const option=text('option',`${s.brand} · ${s.name} · ${s.address}`);option.value=s.id;options.push(option);}
   if(store&&!stores.some(s=>s.id===store.id)){const option=text('option',`${store.brand} · ${store.name}（目前選擇）`);option.value=store.id;options.push(option);}
   $('#store-select').replaceChildren(...options);$('#store-select').value=store?.id||'';
  }catch(error){$('#store-status').textContent=`門市清單讀取失敗：${error.message}。仍可手動填入門市。`;}
 }
 async function choose(value){if(isBusy()||reporting)return;store=value;save();render();await onChanged();}
 $('#store-search-form').onsubmit=e=>{e.preventDefault();if(!isBusy())search();};
 $('#store-select').onchange=()=>{if(isBusy()||reporting){$('#store-select').value=store?.id||'';return;}return choose(stores.find(s=>s.id===$('#store-select').value)||(store?.id===$('#store-select').value?store:null));};
 $('#store-custom-form').onsubmit=async e=>{
  e.preventDefault();if(isBusy()||reporting)return;setBusy(true);
  try{const value=await api('/api/stores/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:$('#store-brand').value,name:$('#store-name').value,address:$('#store-address').value})});setBusy(false);await choose(value);await search();}
  catch(error){$('#store-status').textContent=error.message;}finally{setBusy(false);}
 };
 function decorate(target,d,rec){
  const selected=store,s=rec?.availability?.storeId===selected?.id?rec.availability:null;
  const labels={available:'已確認供應',sold_out:'暫時售完',not_sold:'門市未販售',unknown:'供應待確認'};
  const line=text('p',selected&&d.brand===selected.brand?`${selected.name}：${labels[s?.status||'unknown']}${s?.checkedAt?' · 最後確認 '+new Date(s.checkedAt).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'}):' · 尚未確認此店菜單'}`:'各門市供應可能不同；選擇門市後可回報缺品。','field-help store-availability');target.append(line);
  if(s?.evidence)target.append(text('p',s.evidence,'field-help'));
  if(s?.sourceUrl?.startsWith('https://')){const link=text('a','查看供應查證來源','field-help');link.href=s.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';target.append(link);}
  if(!rec||!selected||selected.brand!==d.brand)return;
  const controls=text('div','','card-actions');
  for(const [kind,label]of [['sold_out','今天售完'],['not_sold','菜單沒有']]){
   const button=text('button',label);button.type='button';button.dataset.storeReport=kind;button.setAttribute('aria-label',`${selected.name}的${d.name}${label}`);button.disabled=locked||reporting;
   button.onclick=async()=>{
    if(isBusy()||reporting)return;const turn=button.closest('.chat-message');if(turn&&turn!==turn.parentElement.lastElementChild)return;if(store?.id!==selected.id){$('#store-status').textContent='門市已變更，請使用最新推薦回報。';return;}
    reporting=true;setBusy(true);lock(true);$('#store-status').textContent='正在記錄缺品回報…';
    const requestKey=selected.id+key(d)+kind;if(!attempts.has(requestKey))attempts.set(requestKey,crypto.randomUUID());
    try{
     const result=await api('/api/stores/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:attempts.get(requestKey),reporterId,store:selected,drinkId:d.id,kind})});
     records[selected.id]=[...current().filter(r=>key(r)!==key(d)),{drinkId:d.id,brand:d.brand,name:d.name,kind,reportedAt:result.reportedAt}].slice(-200);save();render();
     setBusy(false);await onChanged();$('#store-status').textContent=`已回報${selected.name}的${d.name}${label}，並在此分頁排除；推薦更新結果請查看推薦區。回報尚待查證，不影響其他人或口味偏好。`;
    }catch(error){$('#store-status').textContent=`回報未完成：${error.message}`;}
    finally{reporting=false;setBusy(false);lock(false);}
   };controls.append(button);
  }
  target.append(controls);
 }
 render();search();
 return {decorate,lock,accept(value){if(store&&value?.id===store.id&&value.verified!==store.verified){store=value;save();render();}},currentStore:()=>store,body:()=>({store,storeReports:current().map(({drinkId,kind,reportedAt})=>({storeId:store.id,drinkId,kind,reportedAt}))}),setBrands(brands){$('#store-brand').append(...brands.map(b=>{const option=text('option',b);option.value=b;return option;}));}};
}
