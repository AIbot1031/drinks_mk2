import {initChat} from './chat.js';
let chatController;
const $ = selector => document.querySelector(selector);
const el = (tag, text = '', cls = '') => {const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n;};
const storageKey = 'drinks-mk2-feedback-v1';
let feedback = {version: 1, liked: {}, disliked: []};
let meta, busy = false, exhausted = false, lastSettings = null, seen = [], page = 1, pages = 1;
let catalogRequest = 0, graphRequest = 0, favoritesRequest = 0;
let accountUser = null, preferenceBusy = false, accountBusy = true, preferenceSync = Promise.resolve();
try {const saved = localStorage.getItem(storageKey); if (saved) feedback = validateFeedback(JSON.parse(saved));} catch {$('#feedback-note').textContent = '本機偏好讀取失敗，這次會使用空白偏好。';}

let confirmedFeedback = structuredClone(feedback);
const productKey = d => JSON.stringify([d.brand,d.name]);
const likedProducts = () => new Set(Object.values(feedback.liked).map(productKey));
const removeLikedProduct = d => {for(const [id,liked] of Object.entries(feedback.liked))if(productKey(liked)===productKey(d))delete feedback.liked[id];};

function validateFeedback(value) {
  if (!value || value.version !== 1 || !value.liked || typeof value.liked !== 'object' || Array.isArray(value.liked) || !Array.isArray(value.disliked)) throw new Error('偏好檔案格式有誤');
  if (Object.keys(value.liked).length > 200 || value.disliked.length > 200) throw new Error('每種偏好最多保存 200 款');
  for (const [id, d] of Object.entries(value.liked)) if (typeof id !== 'string' || id.length > 80 || !d || d.id !== id || typeof d.name !== 'string' || typeof d.brand !== 'string' || !Array.isArray(d.tea) || !Array.isArray(d.milk) || !Array.isArray(d.toppings)) throw new Error('偏好資料內容有誤');
  if (value.disliked.some(id => typeof id !== 'string' || id.length > 80)) throw new Error('不喜歡的紀錄格式有誤');
  return {version: 1, liked: value.liked, disliked: [...new Set(value.disliked)]};
}
function updateFeedbackDisplay(message = '') {
  $('#favorite-count').textContent = likedProducts().size;
  $('#feedback-note').textContent = message;
  $('#collection-status').textContent = message;
  refreshFeedbackButtons();
  if (location.hash === '#favorites') renderFavorites();
  if (location.hash === '#graph') loadGraph();
}
function saveFeedback() {
  const snapshot=structuredClone(feedback), owner=accountUser?.id;
  preferenceBusy=true;refreshFeedbackButtons();updateAccountButtons();
  preferenceSync=(async()=>{
    let message;
    try {
      if(owner){feedback=await api('/api/account/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({likedIds:Object.keys(snapshot.liked),dislikedIds:snapshot.disliked})});message='偏好已保存到你的帳號，其他裝置登入後也能查看。';}
      else {localStorage.setItem(storageKey,JSON.stringify(snapshot));message='訪客偏好已保存在這個瀏覽器。登入可保存到自己的帳號。';}
      confirmedFeedback=structuredClone(feedback);
    }catch(error){feedback=structuredClone(confirmedFeedback);message=`未能保存這次變更：${error.message}`;}
    finally {preferenceBusy=false;updateAccountButtons();updateFeedbackDisplay(message);}
  })();
  return preferenceSync;
}
function guestFeedback(){try {const raw=localStorage.getItem(storageKey);return raw?validateFeedback(JSON.parse(raw)):{version:1,liked:{},disliked:[]};}catch{return {version:1,liked:{},disliked:[]};}}
function updateAccountButtons(){
  $('#account-open').textContent=accountUser?`帳號：${accountUser.id}`:'登入 / 註冊';
  $('#account-open').disabled=accountBusy||preferenceBusy||busy;
  $('#account-logout').hidden=!accountUser;$('#account-logout').disabled=accountBusy||preferenceBusy||busy;
  $('#save-guest-feedback').hidden=!accountUser;
  $('#save-guest-feedback').disabled=accountBusy||preferenceBusy;
  $('#collection-description').textContent=accountUser?'收藏與不喜歡清單保存在你的帳號，其他裝置登入後也能查看。':'訪客偏好保存在這個瀏覽器；登入後可保存到自己的帳號。';
}
async function switchAccount(user){
  const prefs=user?await api('/api/account/preferences'):guestFeedback();
  chatController?.reset();
  accountUser=user;if(user&&$('#account-dialog').open)$('#account-dialog').close();feedback=validateFeedback(prefs);confirmedFeedback=structuredClone(feedback);
  await chatController?.setAccount(user);
  lastSettings=null;seen=[];$('#batch-actions').hidden=true;
  // A previous user's recommendations must not remain visible after switching accounts.
  $('#results').replaceChildren();$('#result-count').textContent='等你說說偏好';$('#result-status').textContent='';$('#result-warnings').hidden=true;$('#active-filters').replaceChildren();
  updateAccountButtons();updateFeedbackDisplay(user?`已登入 ${user.id}，已載入帳號偏好。`:'已切回這個瀏覽器的訪客偏好。');
}
$('#account-open').onclick=()=>{if(accountUser){location.hash='#favorites';return;}$('#account-status').textContent='';$('#account-dialog').showModal();};
$('#account-close').onclick=()=>$('#account-dialog').close();
$('#account-form').onsubmit=async event=>{
  event.preventDefault();if(accountBusy||preferenceBusy||busy)return;
  accountBusy=true;updateAccountButtons();$('#account-form').querySelectorAll('button').forEach(b=>b.disabled=true);
  const action=event.submitter?.value==='register'?'register':'login';
  $('#account-status').textContent=action==='register'?'正在建立帳號…':'正在登入…';
  try {const result=await api(`/api/account/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:$('#user-id').value,password:$('#user-password').value})});await switchAccount(result.user);$('#user-password').value='';$('#account-dialog').close();}
  catch(error){$('#account-status').textContent=error.message;}
  finally{accountBusy=false;$('#submit-button').disabled=busy;updateAccountButtons();refreshFeedbackButtons();if(location.hash==='#graph')loadGraph();$('#account-form').querySelectorAll('button').forEach(b=>b.disabled=false);}
};
$('#account-logout').onclick=async()=>{
  if(accountBusy||preferenceBusy||busy)return;accountBusy=true;updateAccountButtons();
  try{await api('/api/account/logout',{method:'POST'});await switchAccount(null);}catch(error){$('#feedback-note').textContent=error.message;}
  finally{accountBusy=false;$('#submit-button').disabled=busy;updateAccountButtons();refreshFeedbackButtons();if(location.hash==='#graph')loadGraph();}
};
$('#save-guest-feedback').onclick=()=>{if(!accountUser||preferenceBusy||accountBusy)return;try{const local=guestFeedback();const merged={version:1,liked:{...feedback.liked,...local.liked},disliked:[...new Set([...feedback.disliked,...local.disliked])]};merged.disliked=merged.disliked.filter(id=>!merged.liked[id]);feedback=validateFeedback(merged);saveFeedback();}catch(error){$('#collection-status').textContent=error.message;}};
function refreshFeedbackButtons() {
  const products=likedProducts();
  document.querySelectorAll('[data-like]').forEach(n => {n.disabled=preferenceBusy||accountBusy;const liked = products.has(n.dataset.product); n.setAttribute('aria-pressed', String(liked)); n.textContent = liked ? '♥ 已收藏' : '♡ 喜歡這杯';});
  document.querySelectorAll('[data-dislike]').forEach(n => {n.disabled=preferenceBusy||accountBusy;const disliked = feedback.disliked.includes(n.dataset.dislike); n.setAttribute('aria-pressed', String(disliked)); n.textContent = disliked ? '已標記不喜歡' : '不太喜歡';});
}
async function api(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '暫時無法完成，請稍後重試。');
  return value;
}

function card(d, index, rec, variants = d.variants || rec?.variants || []) {
  const article = el('article', '', 'drink-card');
  if (index !== undefined) article.append(el('span', String(index + 1).padStart(2, '0'), 'rank'));
  const content = el('div', '', 'card-content'), top = el('div', '', 'card-top');
  if (variants.length > 1) {
    const select=el('select');select.setAttribute('aria-label',`${d.name}的杯型`);
    for(const variant of variants){const option=el('option',`${variant.cupSize || variant.category} · NT$ ${variant.price ?? '未知'}${variant.priceEstimated ? '（估算）' : ''}`);option.value=variant.id;select.append(option);}select.value=d.id;
    select.onchange=()=>{const variant=variants.find(v=>v.id===select.value);article.replaceWith(card(variant,index,null,variants));refreshFeedbackButtons();};
    content.append(select,el('p',`共 ${variants.length} 個可查看的版本，預設最低價；切換後顯示該杯型的價格與營養。`,'field-help'));
  }
  top.append(el('h3', d.name), el('span', d.priceText ? `NT$ ${d.priceText}${d.priceEstimated ? '（估算）' : ''}` : (d.price === null ? '價格未知' : `NT$ ${d.price}`), 'price'));
  content.append(top, el('span', `${d.brand} · ${d.category}`, 'brand-label'));
  content.append(el('p', d.taste || '原表未提供風味描述', 'taste'));
  if (rec) content.append(el('p', rec.reasoning, 'reason'));
  const nutrition = el('div', '', 'nutrition');
  for (const [label, value] of [['熱量', d.calories === null ? '未知' : `${d.calories} kcal${d.caloriesEstimated ? "（估算）" : ""}`], ['咖啡因', d.caffeineText ? `${d.caffeineText} mg${d.caffeineEstimated ? "（估算）" : ""}` : '未知']]) {const n = el('span', label); n.append(el('strong', value)); nutrition.append(n);}
  content.append(nutrition);
  const actions = el('div', '', 'card-actions');
  const like = el('button', '', ''); like.type = 'button'; like.dataset.like = d.id; like.dataset.product=productKey(d); like.setAttribute('aria-label', `收藏${d.brand}的${d.name}`);
  like.onclick = () => {if(preferenceBusy||accountBusy)return;if (likedProducts().has(productKey(d))) removeLikedProduct(d); else {if (Object.keys(feedback.liked).length >= 200) {$('#feedback-note').textContent = '最多收藏 200 款，請先取消部分收藏。'; return;} feedback.liked[d.id] = {...d,variants:undefined}; feedback.disliked = feedback.disliked.filter(id => id !== d.id);} saveFeedback();};
  const dislike = el('button'); dislike.type = 'button'; dislike.dataset.dislike = d.id; dislike.setAttribute('aria-label', `標記不喜歡${d.name}`);
  dislike.onclick = () => {if(preferenceBusy||accountBusy)return;if (feedback.disliked.includes(d.id)) feedback.disliked = feedback.disliked.filter(id => id !== d.id); else {if (feedback.disliked.length >= 200) {$('#feedback-note').textContent = '最多記錄 200 款不喜歡的飲料。'; return;} feedback.disliked.push(d.id); removeLikedProduct(d);} saveFeedback();};
  actions.append(like, dislike); content.append(actions);
  const details = el('details', '', 'card-details'); details.append(el('summary', '查看資料來源與備註'));
  details.append(el('p', `Excel「${d.sourceSheet || "飲料品項"}」第 ${d.sourceRow} 列。${d.status || ''}`));
  if (d.region) details.append(el('p', `適用地區／門市：${d.region}；容量：${d.volumeMl ?? '未知'} ml。`));
  if(d.milkConflict)details.append(el('p','來源無奶標籤與奶類線索矛盾，已排除於無奶篩選；配方待確認。','card-warning'));
  if (d.fillMethod) details.append(el('p', `填值方式：${d.fillMethod}；${d.reviewStatus || ''}`));
  details.append(el('p', d.notes || '未提供備註。'));
  details.append(el('p', `茶種：${d.tea.join('、') || '未標記'}；奶類：${d.milk.join('、') || (d.noMilk ? '無奶標記' : '未標記')}；配料：${d.toppings.join('、') || '未標記'}。`));
  if(rec?.rankSourceId && rec.rankSourceId!==d.id)details.append(el('p','此卡片按品項的匹配版本排序，預設顯示該品項符合條件的最低價版本。'));
  if (rec) details.append(el('p', `排序依據：路徑 A ${rec.ranks.a === null ? '未列入' : `第 ${rec.ranks.a} 名`}，路徑 B ${rec.ranks.b === null ? '未列入' : `第 ${rec.ranks.b} 名`}。排序分數並非正確率。`));
  details.append(el('p', rec?.warning || '價格可能為起價；過敏原未核對，成分請向店家確認。', 'card-warning'));
  content.append(details); article.append(content); return article;
}

function setBusy(value) {
  busy = value;updateAccountButtons();
  $('#recommend-form').querySelectorAll('input,select,textarea,button').forEach(n => n.disabled = value);
  $('#submit-button').textContent = value ? '正在幫你挑選…' : '幫我找一杯 ↗';
  $('#next-batch').disabled = value || exhausted;
  $('#restart-batch').disabled = value;
}
function readSettings() {
  const optionalNumber = selector => $(selector).value === '' ? undefined : Number($(selector).value);
  return {query: $('#query').value.trim(), filters: {brand: $('#brand').value, excludedBrands:[...$('#excluded-brands').querySelectorAll('input:checked')].map(n=>n.value), maxPrice: optionalNumber('#budget'), milk: $('#milk-filter').value, tea: $('#tea-filter').value, topping: $('#topping-filter').value, maxCalories: optionalNumber('#calories'), maxCaffeine: optionalNumber('#caffeine')}};
}
function tags(filters) {
  $('#active-filters').replaceChildren();
  const labels = {brand: v => v, excludedBrands:v=>v?.length?`不推薦：${v.join('、')}`:null, maxPrice: v => `價格 ≤ ${v} 元`, maxCalories: v => `熱量 ≤ ${v} kcal`, maxCaffeine: v => `咖啡因上界 ≤ ${v} mg`, milk: v => ({none:'無奶標記', fresh:'鮮奶', plant:'植物奶'})[v], tea: v => v, topping: v => v};
  for (const [key, value] of Object.entries(filters)) {const label = labels[key]?.(value); if (label) $('#active-filters').append(el('span', label));}
}
async function recommend(settings, next = false) {
  if (busy||accountBusy) return;
  await preferenceSync;
  if(busy||accountBusy)return;
  if (!next) exhausted = false;
  setBusy(true);
  // Batched exclusions are independent of personal dislikes and do not affect learned preferences.
  $('#result-status').textContent = '正在比對你的偏好與飲料資料…';
  try {
    const value = await api('/api/recommend', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...settings, limit:6, likedIds:Object.keys(feedback.liked), dislikedIds:feedback.disliked, excludedIds:next ? seen : []})});
    tags(value.filters);
    $('#result-warnings').replaceChildren(...value.warnings.map(w => el('p', w)));
    $('#result-warnings').hidden = !value.warnings.length;
    if (next && !value.results.length) {exhausted = true; $('#result-status').textContent = '這組設定的候選已看完。可以從頭看，或調整條件。'; return;}
    lastSettings = settings;
    if (!next) seen = [];
    seen.push(...value.results.map(r => r.id));
    $('#result-count').textContent = `${value.results.length} 杯推薦 / ${value.eligibleCount.toLocaleString()} 杯符合篩選`;
    $('#results').className = '';
    $('#results').replaceChildren();
    if (!value.results.length) {
      $('#results').className = 'empty-state';
      $('#results').append(el('span', '◡', 'empty-cup'), el('h3', value.blocked ? '先釐清條件，再幫你挑。' : '這次沒有符合的飲料'), el('p', value.blocked ? '請查看上方說明，調整需求後再查詢。' : '試著調整品牌、預算或營養上限。篩選條件不會自動放寬。'));
    } else value.results.forEach((r, i) => $('#results').append(card(r.drink, i, r)));
    $('#batch-actions').hidden = !value.results.length;
    $('#result-status').textContent = `${value.mode.routeA==='macbert'?'語意搜尋：MacBERT。':value.mode.routeAFallback?'Mac 暫時無法推論，改用 TF-IDF 備援。':'文字搜尋：TF-IDF。'} ${value.mode.personalized ? '已參考你的收藏偏好。' : '收藏喜歡的飲料，讓下次更貼近你的口味。'} ${next ? `已看過 ${seen.length} 杯。` : ''}`;
    refreshFeedbackButtons();
  } catch (error) {$('#result-status').textContent = `${error.message} ${$('#results .drink-card') ? '已保留上一份結果。' : ''}`;}
  finally {setBusy(false);}
}
$('#recommend-form').onsubmit = event => {event.preventDefault(); recommend(readSettings());};
function updateExcludedBrandCount(){const count=$('#excluded-brands').querySelectorAll('input:checked').length;$('#excluded-brand-count').textContent=count?`已排除 ${count} 個`:'未排除';}
$('#clear-excluded-brands').onclick=()=>{$('#excluded-brands').querySelectorAll('input').forEach(n=>n.checked=false);$('#recommend-form').dispatchEvent(new Event('input'));};
$('#recommend-form').oninput = () => {updateExcludedBrandCount();if (lastSettings) {$('#batch-actions').hidden = true; $('#result-status').textContent = '條件已變更，按「幫我找一杯」套用新設定。';}};
$('#recommend-form').onchange = $('#recommend-form').oninput;
$('#next-batch').onclick = () => {if (lastSettings) recommend(lastSettings, true);};
$('#restart-batch').onclick = () => {if (lastSettings) recommend(lastSettings);};
$('#reset-filters').onclick = () => {$('#recommend-form').reset();updateExcludedBrandCount(); $('#batch-actions').hidden = true; lastSettings = null; seen = []; $('#result-status').textContent = '偏好條件已重設。';};
document.querySelectorAll('[data-query]').forEach(n => n.onclick = () => {$('#query').value = n.dataset.query; $('#batch-actions').hidden = true; $('#query').focus();});
$('#inspiration').onclick = () => {$('#query').value = '想喝清爽、回甘的茶'; recommend(readSettings());};

async function loadCatalog() {
  const id = ++catalogRequest;
  $('#catalog-status').textContent = '正在讀取飲料圖鑑…';
  try {
    const params = new URLSearchParams({q:$('#catalog-query').value, brand:$('#catalog-brand').value, page:String(page)});
    const value = await api(`/api/catalog?${params}`);
    if (id !== catalogRequest) return;
    pages = value.pages;
    $('#catalog-results').replaceChildren(...value.results.map(d => card(d)));
    $('#catalog-status').textContent = `${value.total.toLocaleString()} 款飲料符合搜尋${value.total ? '' : '，請調整名稱或品牌'}。`;
    $('#page-info').textContent = `第 ${page} / ${Math.max(1, pages)} 頁`;
    $('#prev-page').disabled = page <= 1; $('#next-page').disabled = page >= pages;
    refreshFeedbackButtons();
  } catch (error) {if (id === catalogRequest) $('#catalog-status').textContent = error.message;}
}
$('#catalog-form').onsubmit = event => {event.preventDefault(); page = 1; loadCatalog();};
$('#prev-page').onclick = () => {if (page > 1) {page--; loadCatalog();}};
$('#next-page').onclick = () => {if (page < pages) {page++; loadCatalog();}};
async function renderFavorites() {
  const request=++favoritesRequest;
  const list = Object.values(feedback.liked);
  const groups=new Map();for(const d of list){const key=JSON.stringify([d.brand,d.name]);const items=groups.get(key)||[];items.push(d);groups.set(key,items);}
  $('#favorites-results').replaceChildren(...[...groups.values()].map(variants=>{variants.sort((a,b)=>(a.price??Infinity)-(b.price??Infinity));return card(variants[0],undefined,undefined,variants);}));
  if (!list.length) $('#favorites-results').append(el('p', '還沒有收藏。遇到喜歡的一杯，按「♡ 喜歡這杯」就能留下來。', 'status'));
  refreshFeedbackButtons();
  if(!list.length)return;
  try {
    const value=await api('/api/catalog/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({likedIds:Object.keys(feedback.liked)})});
    if(request!==favoritesRequest)return;
    $('#favorites-results').replaceChildren(...value.results.map(d=>card(d)));
    if(!value.results.length)$('#favorites-results').append(el('p','收藏品項已不在目前目錄中。','status'));
    refreshFeedbackButtons();
  }catch(error){if(request===favoritesRequest)$('#collection-status').textContent=`目前只顯示已保存杯型，完整杯型讀取失敗：${error.message}`;}
}
$('#export-feedback').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(feedback, null, 2)], {type:'application/json'}));
  const a = el('a'); a.href = url; a.download = '我的飲料偏好.json'; a.click(); URL.revokeObjectURL(url);
  $('#collection-status').textContent = '偏好已匯出。另一個瀏覽器可以用「匯入偏好」接續收藏。';
};
$('#import-feedback').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  if(preferenceBusy||accountBusy){event.target.value='';return;}
  try {if (file.size > 1024 * 1024) throw new Error('偏好檔案不可超過 1 MB'); const imported = validateFeedback(JSON.parse(await file.text())); const merged = {version:1, liked:{...feedback.liked,...imported.liked}, disliked:[...new Set([...feedback.disliked,...imported.disliked])]}; merged.disliked = merged.disliked.filter(id => !merged.liked[id]); feedback = validateFeedback(merged); await saveFeedback(); renderFavorites();} catch(error) {$('#collection-status').textContent = error.message || '無法匯入偏好檔案。';} finally {event.target.value = '';}
};

async function loadGraph() {
  const request = ++graphRequest;
  $('#graph-status').textContent = '正在整理飲料關係…';
  $('#graph').replaceChildren();$('#graph-detail').textContent='點選節點查看連結。';
  if(accountBusy||preferenceBusy){$('#graph-status').textContent='正在讀取你的按讚資料…';return;}
  try {
    const query=$('#graph-query').value.trim().toLowerCase(),brand=$('#graph-brand').value;
    const own=$('#graph-scope').value==='likes';
    const saved=likedProducts();
    const params = new URLSearchParams({q:query,brand});
    const value = own ? await api('/api/catalog/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({likedIds:Object.keys(feedback.liked)})}) : await api(`/api/catalog?${params}`);
    if (request !== graphRequest) return;
    const list = own ? value.results.filter(d=>(!brand||d.brand===brand)&&`${d.name} ${d.brand} ${d.taste}`.toLowerCase().includes(query)) : value.results.slice(0,12);
    const liked=list.filter(d=>saved.has(productKey(d)));
    const svg = $('#graph'); svg.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    const shape = (tag, attrs, text) => {const n = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k,String(v)); if (text !== undefined) n.textContent = text; return n;};
    const brands = [...new Set(list.map(d => d.brand))];
    const featureNames = d => [...d.tea.map(t => `茶：${t}`), ...d.milk.map(t => `奶：${t}`), ...d.toppings.map(t => `料：${t}`)];
    const features = [...new Set(list.flatMap(featureNames))];
    const height = Math.max(480, list.length * 48 + 100, features.length * 43 + 100);
    svg.setAttribute('viewBox', `0 0 1000 ${height}`);
    const positions = new Map();
    const groups = [liked.length ? [{id:'viewer',label:accountUser?'我的帳號':'這個瀏覽器',type:'user'}] : [], brands.map(b => ({id:`brand:${b}`,label:b,type:'brand'})), list.map(d => ({id:d.id,label:d.name,type:'drink',drink:d})), features.map(f => ({id:`feature:${f}`,label:f,type:'feature'}))];
    const all = groups.flat();
    groups.forEach((group, col) => {svg.append(shape('text',{x:[80,280,535,830][col],y:30,'text-anchor':'middle',fill:'#809171','font-size':12}, ['我的按讚','品牌','飲料','茶種／奶類／配料'][col])); group.forEach((n,i) => positions.set(n.id, {x:[80,280,535,830][col],y:65+(height-110)*(i+.5)/Math.max(1,group.length)}));});
    const edges = [...liked.map(d=>({from:'viewer',to:d.id,liked:true})),...list.flatMap(d => [{from:`brand:${d.brand}`,to:d.id}, ...featureNames(d).map(f => ({from:d.id,to:`feature:${f}`}))])];
    const lines = edges.map(edge => {const a = positions.get(edge.from), b = positions.get(edge.to); const n = shape('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:edge.liked?'graph-edge liked':'graph-edge'}); svg.append(n); return {edge,n};});
    for (const n of all) {
      const p = positions.get(n.id), width = n.type === 'drink' ? 235 : n.type==='user'?120:160;
      const isLiked=n.drink&&saved.has(productKey(n.drink));
      const label=(isLiked?'♥ ':'')+n.label;
      const colors = {user:['#fce7e5','#b42318'],liked:['#fce7e5','#b42318'],brand:['#e8efdf','#648b57'],drink:['#edf3f4','#8daabc'],feature:['#f5efde','#c3a76c']};
      const group = shape('g',{transform:`translate(${p.x},${p.y})`,class:'graph-node',tabindex:0,role:'button','aria-label':label});
      group.append(shape('rect',{x:-width/2,y:-17,width,height:34,rx:8,fill:colors[isLiked?'liked':n.type][0],stroke:colors[isLiked?'liked':n.type][1]}),shape('text',{'text-anchor':'middle',y:4},label.length>15 ? `${label.slice(0,14)}…` : label),shape('title',{},label));
      const select = () => {lines.forEach(({edge,n:line}) => line.setAttribute('class',`graph-edge${edge.liked?' liked':''}${edge.from === n.id || edge.to === n.id ? ' highlight' : ''}`)); const related = edges.filter(e => e.from===n.id || e.to===n.id).map(e => all.find(other => other.id === (e.from===n.id?e.to:e.from)).label); $('#graph-detail').textContent = `${isLiked?'♥ 你已按讚。':''}${n.label}：連結 ${related.join('、') || '無已標記特徵'}。${n.drink ? `來源：Excel 第 ${n.drink.sourceRow} 列。` : ''}`;};
      group.onclick = select; group.onkeydown = event => {if (event.key==='Enter'||event.key===' ') {event.preventDefault(); select();}}; svg.append(group);
    }
    $('#graph-status').textContent = `${own?'我的按讚':'目錄範例'}：顯示 ${list.length} 款飲料，其中 ${liked.length} 款已按讚；${all.length} 個節點、${edges.length} 條關係。${own?'搜尋／品牌篩選會限制顯示；共有 '+saved.size+' 款按讚。':'共 '+value.total+' 款符合搜尋，顯示前 12 款。'}`;
    if (!list.length) $('#graph-detail').textContent = own&&!saved.size?'還沒有按讚飲料。先在推薦或圖鑑按「喜歡這杯」，或切換到目錄範例。':'沒有符合的飲料，請清除搜尋或品牌篩選。';
  } catch(error) {if (request === graphRequest) $('#graph-status').textContent = error.message;}
}
$('#graph-scope').onchange=()=>loadGraph();
$('#graph-form').onsubmit = event => {event.preventDefault(); loadGraph();};
chatController=initChat({api,card,feedback:()=>feedback,isBusy:()=>busy||accountBusy||preferenceBusy,setBusy,refresh:refreshFeedbackButtons,ready:()=>preferenceSync});
function showView() {
  const requested = location.hash.slice(1) || 'recommend';
  if(requested==='chat')chatController.setMode('chat');
  if(requested==='login'&&!accountUser&&!$('#account-dialog').open)$('#account-dialog').showModal();
  const view = ['recommend','catalog','favorites','graph'].includes(requested) ? requested : 'recommend';
  document.querySelectorAll('.view').forEach(n => n.hidden = n.id !== `${view}-view`);
  document.querySelectorAll('.header nav a').forEach(n => {const active=n.hash===`#${view}`; n.classList.toggle('active',active); if(active)n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current');});
  if (view==='catalog') loadCatalog(); else if (view==='favorites') renderFavorites(); else if (view==='graph') loadGraph();
}
window.addEventListener('hashchange', showView);
$('#favorite-count').textContent = likedProducts().size;
try {
  meta = await api('/api/meta');
  $('#catalog-summary').textContent = `${meta.total.toLocaleString()} 款飲料 · ${Object.keys(meta.brands).length} 個品牌`;
  for (const brand of Object.keys(meta.brands)) for (const selector of ['#brand','#catalog-brand','#graph-brand']) {const option=el('option',brand); option.value=brand; $(selector).append(option);}
  for (const brand of Object.keys(meta.brands)){const label=el('label'),checkbox=el('input');checkbox.type='checkbox';checkbox.value=brand;checkbox.name='excludedBrand';label.append(checkbox,el('span',brand));$('#excluded-brands').append(label);}
  for (const [values,selector] of [[meta.tea,'#tea-filter'],[meta.toppings,'#topping-filter']]) for (const v of values) {const option=el('option',v); option.value=v; $(selector).append(option);}
} catch(error) {$('#catalog-summary').textContent='資料讀取失敗，請重新整理。'; $('#result-status').textContent=error.message;}
showView();
try {const result=await api('/api/account/me');await switchAccount(result.user);}catch(error){$('#feedback-note').textContent=`帳號暫時無法讀取：${error.message}`;}finally{accountBusy=false;$('#submit-button').disabled=busy;updateAccountButtons();refreshFeedbackButtons();if(location.hash==='#graph')loadGraph();}
