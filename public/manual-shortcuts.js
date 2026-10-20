export const manualDefaults=[{label:'清爽回甘',message:'想喝清爽、回甘的茶'},{label:'果香酸甜',message:'想喝果香、酸甜的飲料'},{label:'濃郁奶香',message:'想喝鮮奶調製、奶香濃郁的飲料'},{label:'嚼點配料',message:'想喝有嚼勁的珍珠飲料'}];
export function validateManualShortcuts(items){
 if(!Array.isArray(items)||items.length>8)throw Error('快捷設定最多 8 個');
 return items.map(item=>{
  if(!item||typeof item.label!=='string'||!item.label.trim()||item.label.trim().length>20||typeof item.message!=='string'||!item.message.trim()||item.message.trim().length>300)throw Error('名稱需為 1～20 字，偏好文字需為 1～300 字。');
  return {label:item.label.trim(),message:item.message.trim()};
 });
}
export function initManualShortcuts({api,isBusy}){
 const $=s=>document.querySelector(s),dialog=$('#manual-shortcuts-dialog'),form=$('#manual-shortcuts-form'),rows=$('#manual-shortcuts-rows'),note=$('#manual-shortcuts-note');
 const key='drinks-manual-shortcuts-v1';let owner=null,items=structuredClone(manualDefaults),draft=[],saving=false,epoch=0;
 const el=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};
 function render(){
  $('#manual-shortcuts').replaceChildren(...items.map(item=>{const button=el('button',item.label);button.type='button';button.dataset.query=item.message;
   button.onclick=()=>{if(isBusy()||saving)return;$('#query').value=item.message;$('#query').dispatchEvent(new Event('input',{bubbles:true}));$('#batch-actions').hidden=true;$('#query').focus();};return button;}));
 }
 function read(){return [...rows.children].map(row=>({label:row.querySelector('input').value,message:row.querySelector('textarea').value}));}
 function draw(){
  rows.replaceChildren(...draft.map((item,index)=>{const row=el('div','');row.className='shortcut-row';
   const label=el('label',`快捷 ${index+1} 名稱`),input=el('input','');input.value=item.label;input.maxLength=20;input.required=true;label.append(input);
   const demand=el('label',`快捷 ${index+1} 偏好文字`),message=el('textarea','');message.value=item.message;message.maxLength=300;message.required=true;message.rows=2;demand.append(message);
   const remove=el('button',`刪除快捷 ${index+1}`);remove.type='button';remove.className='text-button';remove.onclick=()=>{draft=read().filter((_,i)=>i!==index);draw();};row.append(label,demand,remove);return row;}));
  $('#manual-shortcuts-add').disabled=draft.length>=8;
 }
 async function setAccount(user){
  const token=++epoch;owner=user?.id??null;items=structuredClone(manualDefaults);note.textContent='';dialog.close();render();
  try{
   const value=user?(await api('/api/account/manual-shortcuts')).shortcuts:JSON.parse(localStorage.getItem(key)||'null');
   if(token!==epoch)return;if(value!==null)items=validateManualShortcuts(value);render();
  }catch(error){if(token===epoch)note.textContent=`快捷設定讀取失敗，暫用預設：${error.message}`;}
 }
 $('#manual-shortcuts-edit').onclick=()=>{if(isBusy()||saving)return;draft=structuredClone(items);draw();$('#manual-shortcuts-status').textContent='';dialog.showModal();};
 $('#manual-shortcuts-close').onclick=()=>{if(!saving)dialog.close();};dialog.oncancel=e=>{if(saving)e.preventDefault();};
 $('#manual-shortcuts-add').onclick=()=>{draft=read();if(draft.length<8){draft.push({label:'',message:''});draw();}};
 $('#manual-shortcuts-defaults').onclick=()=>{draft=structuredClone(manualDefaults);draw();};
 form.onsubmit=async event=>{
  event.preventDefault();if(saving||isBusy())return;const token=epoch,account=owner;saving=true;
  form.querySelectorAll('button,input,textarea').forEach(n=>n.disabled=true);
  try{const next=validateManualShortcuts(read());
   if(account)await api('/api/account/manual-shortcuts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({shortcuts:next})});
   else localStorage.setItem(key,JSON.stringify(next));
   if(token!==epoch)return;items=next;render();dialog.close();note.textContent=account?'快捷設定已保存到帳號。':'快捷設定已保存在這個瀏覽器。';
  }catch(error){if(token===epoch)$('#manual-shortcuts-status').textContent=`未儲存：${error.message}`;}
  finally{saving=false;form.querySelectorAll('button,input,textarea').forEach(n=>n.disabled=false);$('#manual-shortcuts-add').disabled=draft.length>=8;}
 };
 render();return {setAccount};
}
