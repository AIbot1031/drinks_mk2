import {rankingStatus} from './ranking-status.js';
import {appendAlternatives} from './alternatives.js';
import {conditionLabels} from './chat-conditions.js';
import {appendWellbeingSources} from './wellbeing-sources.js';
export function initChat({api,card,feedback,isBusy,setBusy,refresh,ready}) {
  const $=s=>document.querySelector(s);
  let state={query:'',filters:{},guard:''},seen=[],pending=false,history=[],lastReply=null;
  const defaults=[{label:'清爽、60 元內',message:'清爽回甘，預算 60 元'},{label:'不要星巴克',message:'不要星巴克'},{label:'再推薦幾杯',message:'再推薦幾杯'}];
  let shortcuts=structuredClone(defaults),shortcutOwner=null,draft=[];
  const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
  function renderShortcuts(){
    $('#chat-shortcuts').replaceChildren(...shortcuts.map(item=>{const button=text('button',item.label);button.type='button';button.dataset.chat=item.message;button.disabled=pending;button.onclick=()=>send(item.message);return button;}));
  }
  function readDraft(){return [...$('#chat-shortcuts-rows').children].map(row=>({label:row.querySelector('input').value,message:row.querySelector('textarea').value}));}
  function renderDraft(){
    $('#chat-shortcuts-rows').replaceChildren(...draft.map((item,index)=>{
      const row=document.createElement('div');row.className='shortcut-row';
      const label=document.createElement('label');label.append(text('span',`標籤 ${index+1} 名稱`));
      const name=document.createElement('input');name.value=item.label;name.maxLength=20;name.required=true;label.append(name);
      const demand=document.createElement('label');demand.append(text('span',`標籤 ${index+1} 推薦需求`));
      const message=document.createElement('textarea');message.value=item.message;message.maxLength=300;message.rows=2;message.required=true;demand.append(message);
      const remove=text('button',`刪除標籤 ${index+1}`,'text-button');remove.type='button';remove.onclick=()=>{draft=readDraft().filter((_,i)=>i!==index);renderDraft();};
      row.append(label,demand,remove);return row;
    }));$('#chat-shortcuts-add').disabled=draft.length>=8;
  }
  async function setAccount(user){
    shortcutOwner=user?.id??null;shortcuts=structuredClone(defaults);renderShortcuts();$('#chat-shortcuts-edit').hidden=!user;$('#chat-shortcuts-note').textContent='';
    if($('#chat-shortcuts-dialog').open)$('#chat-shortcuts-dialog').close();
    if(user){try{const value=await api('/api/account/shortcuts');shortcuts=value.shortcuts;renderShortcuts();}catch(error){$('#chat-shortcuts-note').textContent=`快捷標籤暫時無法讀取：${error.message}`;}}
  }
  $('#chat-shortcuts-edit').onclick=()=>{if(pending||isBusy()||!shortcutOwner)return;draft=structuredClone(shortcuts);renderDraft();$('#chat-shortcuts-status').textContent='';$('#chat-shortcuts-dialog').showModal();};
  $('#chat-shortcuts-close').onclick=()=>{if(!pending)$('#chat-shortcuts-dialog').close();};
  $('#chat-shortcuts-dialog').oncancel=event=>{if(pending)event.preventDefault();};
  $('#chat-shortcuts-add').onclick=()=>{draft=readDraft();if(draft.length<8){draft.push({label:'',message:''});renderDraft();}};
  $('#chat-shortcuts-form').onsubmit=async event=>{
    event.preventDefault();if(pending||isBusy()||!shortcutOwner)return;const items=readDraft();
    lock(true);$('#chat-shortcuts-form').querySelectorAll('button,input,textarea').forEach(n=>n.disabled=true);$('#chat-shortcuts-status').textContent='正在儲存…';
    try{const value=await api('/api/account/shortcuts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({shortcuts:items})});shortcuts=value.shortcuts;renderShortcuts();$('#chat-shortcuts-dialog').close();$('#chat-shortcuts-note').textContent='快捷標籤已儲存到你的帳號。';}
    catch(error){$('#chat-shortcuts-status').textContent=`未儲存：${error.message}`;}
    finally{lock(false);$('#chat-shortcuts-form').querySelectorAll('button,input,textarea').forEach(n=>n.disabled=false);$('#chat-shortcuts-add').disabled=items.length>=8;}
  };
  function bubble(role,message){
    const n=document.createElement('div');n.className=`chat-message ${role}`;
    n.append(text('span',role==='user'?'你':'喝點剛好的','chat-speaker'),text('p',message));
    $('#chat-log').append(n);
    while($('#chat-log').children.length>24)$('#chat-log').firstElementChild.remove();
    return n;
  }
  function showFilters(message, reset = false){
    document.dispatchEvent(new CustomEvent('drink-atmosphere', {detail: {source: 'chat', filters: state.filters, message, reset}}));
    $('#chat-filters').replaceChildren(...conditionLabels(state).map(v=>text('span',v)));
  }

  function reset(){if(pending)return;lastReply=null;state={query:'',filters:{},guard:''};seen=[];history=[];$('#chat-log').replaceChildren();$('#chat-message').value='';$('#chat-status').textContent='';$('#chat-recovery').hidden=true;showFilters('', true);bubble('assistant','今天想喝什麼？可以告訴我口味、品牌與預算，例如「清爽回甘，預算 60 元」。');}
  function setMode(mode){
    $('#manual-panel').hidden=mode==='chat';$('#chat-panel').hidden=mode!=='chat';
    $('#manual-mode').setAttribute('aria-pressed',String(mode!=='chat'));$('#chat-mode').setAttribute('aria-pressed',String(mode==='chat'));
    document.dispatchEvent(new CustomEvent('drink-atmosphere'));
  }
  function lock(value){pending=value;setBusy(value);$('#chat-send').disabled=value;$('#chat-reset').disabled=value;$('#chat-reset-bottom').disabled=value;$('#chat-shortcuts-edit').disabled=value;$('#chat-message').disabled=value;document.querySelectorAll('[data-chat]').forEach(n=>n.disabled=value);$('#chat-panel').setAttribute('aria-busy',String(value));}
  async function send(message){
    if(pending||isBusy()){ $('#chat-status').textContent='請等目前的操作完成，再送出訊息。';return; }
    await ready();if(isBusy())return;
    lock(true);$('#chat-status').textContent='正在比對飲料與你的條件…';
    bubble('user',message);
    try{
      const prefs=feedback();
      const value=await api('/api/chat/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,state,history,excludedIds:seen,likedIds:Object.keys(prefs.liked),dislikedIds:prefs.disliked})});
      history.push({role:'user',content:message},{role:'assistant',content:value.assistantMessage.slice(0,300)});history=history.slice(-8);$('#chat-recovery').hidden=value.needsClarification||(!value.blocked&&(value.results.length>0||!!value.alternatives?.length));state=value.state;if(!value.next)seen=[];seen.push(...[...value.results,...(value.alternatives??[])].map(r=>r.id));seen=[...new Set(seen)].slice(-2000);showFilters(message);
      const reply=bubble('assistant',value.assistantMessage);lastReply=value.rankingContext?{reply,value}:null;
      reply.append(text('p',value.needsClarification?'本輪保留的條件（待確認）':value.alternatives?.length?'原本要求的條件；接近選擇的差異另列於下方':'這次推薦使用的條件','field-help'));
      const snapshot=document.createElement('div');snapshot.className='filter-tags chat-turn-filters';snapshot.setAttribute('aria-label','本輪實際條件');snapshot.append(...conditionLabels({...value.state,filters:value.filters}).map(v=>text('span',v)));reply.append(snapshot);
      if(value.choices?.length){const choices=document.createElement('div');choices.className='chat-choices';value.choices.forEach(item=>{const button=text('button',item.label);button.type='button';button.dataset.chat=item.message;button.disabled=pending;button.onclick=()=>send(item.message);choices.append(button);});reply.append(choices);}
      if(value.warnings.length)reply.append(text('p',value.warnings.join(' '),'card-warning'));
      appendWellbeingSources(reply,value.wellbeing);
      const cards=document.createElement('div');cards.className='chat-cards';
      value.results.forEach((r,i)=>cards.append(card(r.drink,i,r)));reply.append(cards);appendAlternatives(reply,value,card);refresh();
      $('#chat-message').value='';$('#chat-status').textContent=value.needsClarification?'請補充上方條件，原本的口味與篩選已保留。':(value.chatMode==='quick-command'?'已接續上一輪條件。 ':'')+(value.chatMode==='qwen3.5-9b'?'對話：Qwen3.5-9B。 ':value.chatMode==='qwen3-8b'?'對話：Qwen3-8B。 ':value.chatMode==='rules-fallback'?'對話模型暫時不可用，使用規則備援。 ':'')+rankingStatus(value);
    }catch(error){$('#chat-recovery').hidden=false;bubble('assistant',`這次未完成推薦：${error.message}。已保留上一輪條件，請再試一次。`);$('#chat-status').textContent='訊息未成功處理，輸入內容已保留。';}
    finally{lock(false);$('#chat-message').focus();$('#chat-log').lastElementChild?.scrollIntoView({block:'nearest'});}
  }
  $('#manual-mode').onclick=()=>setMode('manual');$('#chat-mode').onclick=()=>setMode('chat');$('#chat-reset').onclick=reset;$('#chat-reset-bottom').onclick=reset;
  $('#chat-form').onsubmit=e=>{e.preventDefault();const message=$('#chat-message').value.trim();if(message)send(message);};
  $('#chat-message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}};
  document.querySelectorAll('[data-chat]').forEach(n=>n.onclick=()=>send(n.dataset.chat));
  async function refreshPreferences(reuse=true){
    if(!lastReply||pending)return;
    const previous=lastReply;lock(true);$('#chat-status').textContent='正在依最新偏好更新推薦…';
    try{
      const prefs=feedback();
      const value=await api(reuse?'/api/preference-refresh':'/api/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(reuse?{rankingContext:previous.value.rankingContext}:previous.value.rankingContext.input),likedIds:Object.keys(prefs.liked),dislikedIds:prefs.disliked})});
      previous.reply.querySelector('p').textContent=value.manualMessage;
      previous.reply.querySelectorAll('.chat-cards,.nearby-section,.preference-update').forEach(n=>n.remove());
      const cards=document.createElement('div');cards.className='chat-cards';value.results.forEach((r,i)=>cards.append(card(r.drink,i,r)));previous.reply.append(cards);appendAlternatives(previous.reply,value,card);
      previous.reply.append(text('p',`已依最新偏好更新：${value.results.length} 杯符合條件的飲料。`,'preference-update field-help'));
      lastReply={reply:previous.reply,value:{...previous.value,...value}};
      seen=[...value.results,...(value.alternatives??[])].map(r=>r.id);
      $('#chat-status').textContent='推薦已依最新收藏與不喜歡更新，對話條件保持不變。';refresh();
    }catch(error){$('#chat-status').textContent=`偏好已保存，但推薦更新失敗：${error.message}，請重新送出查詢。`;}
    finally{lock(false);refresh();}
  }
  renderShortcuts();reset();return {reset,setMode,setAccount,refreshPreferences};
}
