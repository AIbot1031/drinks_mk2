export function initChat({api,card,feedback,isBusy,setBusy,refresh,ready}) {
  const $=s=>document.querySelector(s);
  let state={query:'',filters:{},guard:''},seen=[],pending=false;
  const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
  function bubble(role,message){
    const n=document.createElement('div');n.className=`chat-message ${role}`;
    n.append(text('span',role==='user'?'你':'喝點剛好的','chat-speaker'),text('p',message));
    $('#chat-log').append(n);
    while($('#chat-log').children.length>24)$('#chat-log').firstElementChild.remove();
    return n;
  }
  function showFilters(){
    const labels={excludedToppings:v=>v.length?`不加：${v.join("、")}`:"",milkTea:v=>v?"奶茶":"",maxPrice:v=>`預算 ≤ ${v} 元`,maxCalories:v=>`熱量 ≤ ${v} kcal`,maxCaffeine:v=>`咖啡因 ≤ ${v} mg`,brand:v=>v,excludedBrands:v=>v.length?`不要：${v.join('、')}`:'',milk:v=>({none:'無奶標記',fresh:'鮮奶',plant:'植物奶',any:'奶類不限'})[v],tea:v=>v,topping:v=>v};
    const values=Object.entries(state.filters).map(([k,v])=>labels[k]?.(v)).filter(Boolean);
    if(state.query)values.unshift(`口味：${state.query}`);
    if(state.guard)values.push('有待釐清的限制');
    $('#chat-filters').replaceChildren(...values.map(v=>text('span',v)));
  }
  function reset(){if(pending)return;state={query:'',filters:{},guard:''};seen=[];$('#chat-log').replaceChildren();$('#chat-message').value='';$('#chat-status').textContent='';showFilters();bubble('assistant','今天想喝什麼？可以告訴我口味、品牌與預算，例如「清爽回甘，預算 60 元」。');}
  function setMode(mode){
    $('#manual-panel').hidden=mode==='chat';$('#chat-panel').hidden=mode!=='chat';
    $('#manual-mode').setAttribute('aria-pressed',String(mode!=='chat'));$('#chat-mode').setAttribute('aria-pressed',String(mode==='chat'));
  }
  function lock(value){pending=value;setBusy(value);$('#chat-send').disabled=value;$('#chat-reset').disabled=value;$('#chat-message').disabled=value;document.querySelectorAll('[data-chat]').forEach(n=>n.disabled=value);$('#chat-panel').setAttribute('aria-busy',String(value));}
  async function send(message){
    if(pending||isBusy()){ $('#chat-status').textContent='請等目前的操作完成，再送出訊息。';return; }
    await ready();if(isBusy())return;
    lock(true);$('#chat-status').textContent='正在比對飲料與你的條件…';
    bubble('user',message);
    try{
      const prefs=feedback();
      const value=await api('/api/chat/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,state,excludedIds:seen,likedIds:Object.keys(prefs.liked),dislikedIds:prefs.disliked})});
      state=value.state;if(!value.next)seen=[];seen.push(...value.results.map(r=>r.id));seen=[...new Set(seen)].slice(-2000);showFilters();
      const reply=bubble('assistant',value.assistantMessage);
      if(value.warnings.length)reply.append(text('p',value.warnings.join(' '),'card-warning'));
      const cards=document.createElement('div');cards.className='chat-cards';
      value.results.forEach((r,i)=>cards.append(card(r.drink,i,r)));reply.append(cards);refresh();
      $('#chat-message').value='';$('#chat-status').textContent=(value.chatMode==='qwen3-8b'?'對話：Qwen3-8B。 ':value.chatMode==='rules-fallback'?'對話模型暫時不可用，使用規則備援。 ':'')+(value.mode.routeA==='macbert'?'語意搜尋：MacBERT。 ':value.mode.routeAFallback?'Mac 暫時無法推論，改用 TF-IDF 備援。 ':'')+(value.mode.personalized?'已參考你的帳號／瀏覽器收藏。':'你可以繼續調整條件。');
    }catch(error){bubble('assistant',`這次未完成推薦：${error.message}。已保留上一輪條件，請再試一次。`);$('#chat-status').textContent='訊息未成功處理，輸入內容已保留。';}
    finally{lock(false);$('#chat-message').focus();$('#chat-log').lastElementChild?.scrollIntoView({block:'nearest'});}
  }
  $('#manual-mode').onclick=()=>setMode('manual');$('#chat-mode').onclick=()=>setMode('chat');$('#chat-reset').onclick=reset;
  $('#chat-form').onsubmit=e=>{e.preventDefault();const message=$('#chat-message').value.trim();if(message)send(message);};
  $('#chat-message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}};
  document.querySelectorAll('[data-chat]').forEach(n=>n.onclick=()=>send(n.dataset.chat));
  reset();return {reset,setMode};
}
