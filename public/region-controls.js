export function scopeBody(mode,city,district){
 if(mode==='general')return {searchMode:'general',region:null,store:null,storeReports:[]};
 if(!city||!district)throw Error('請先選擇縣市及鄉鎮市區；地區不會自動放寬。');
 return {searchMode:'region',region:{city,district},store:null,storeReports:[]};
}
export function initRegionControls({api,isBusy,onChanged}){
 const $=s=>document.querySelector(s),mode=$('#search-scope'),city=$('#region-city'),district=$('#region-district'),status=$('#region-status');
 let regions=[],changing=false,previous='general',previousCity='',previousDistrict='';
 function options(select,values,label){const nodes=[new Option(label,'')];for(const value of values)nodes.push(new Option(value,value));select.replaceChildren(...nodes);}
 function render(){const local=mode.value==='region';$('#region-fields').hidden=!local;status.textContent=local?(city.value&&district.value?`地區硬限制：${city.value}${district.value}。只推薦此區已收錄的品牌，不自動跨區。`:'請先選縣市與鄉鎮市區；未完成前不會提供跨區結果。'):'一般推薦不看地區。';}
 async function change(){
  if(isBusy()||changing){mode.value=previous;city.value=previousCity;district.value=previousDistrict;render();return;}
  changing=true;
  try{
   if(city.value!==previousCity){options(district,[...new Set(regions.filter(r=>r.city===city.value).map(r=>r.district))],'請選擇鄉鎮市區');}
   previous=mode.value;previousCity=city.value;previousDistrict=district.value;
   render();
   // Refresh immediately, including incomplete selections: the request fails closed
   // and the old region's cards are removed so they cannot be mistaken for this area.
   document.querySelector('#results')?.replaceChildren();
   document.querySelectorAll('#chat-log .chat-cards,#chat-log .nearby-section').forEach(node=>node.remove());
   if(mode.value==='general'||city.value&&district.value){document.querySelector('#result-status').textContent='';await onChanged();}
   else document.querySelector('#result-status').textContent='請先完成地區選擇，再取得推薦。';
  }catch(error){status.textContent=error.message;}finally{changing=false;}
 }
 mode.onchange=change;city.onchange=change;district.onchange=change;
 render();
 api('/api/regions').then(value=>{regions=value.regions;options(city,[...new Set(regions.map(r=>r.city))],'請選擇縣市');}).catch(()=>{status.textContent='地區清單讀取失敗；一般推薦仍可使用。';});
 return {body:()=>scopeBody(mode.value,city.value,district.value)};
}
