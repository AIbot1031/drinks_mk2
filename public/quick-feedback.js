export function initQuickFeedback({api,scope}){
 const $=s=>document.querySelector(s),dialog=$('#quick-report-dialog'),form=$('#quick-report-form'),status=$('#quick-report-status');
 let pendingId;
 $('#quick-report-open').onclick=()=>{status.textContent='';dialog.showModal();};
 $('#quick-report-close').onclick=()=>dialog.close();
 form.oninput=()=>{pendingId=undefined;};
 form.onsubmit=async event=>{
  event.preventDefault();const submit=$('#quick-report-submit');if(submit.disabled)return;
  submit.disabled=true;status.textContent='正在送出…';
  try{
   let reporterId=localStorage.getItem('drinks-report-browser');
   if(!reporterId){reporterId=crypto.randomUUID();localStorage.setItem('drinks-report-browser',reporterId);}
   pendingId??=crypto.randomUUID();
   let region=null;try{region=scope().region;}catch{/* An incomplete region can still report a problem. */}
   await api('/api/reports/quick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pendingId,reporterId,kind:$('#quick-report-kind').value,message:$('#quick-report-message').value,region})});
   form.reset();pendingId=undefined;status.textContent='已送到團隊檢查，謝謝你的協助！';
  }catch(error){status.textContent=`尚未送出：${error.message}`;}finally{submit.disabled=false;}
 };
}
