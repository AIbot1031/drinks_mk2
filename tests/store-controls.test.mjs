import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activeReports} from '../public/store-controls.js';
test('browser session reports expire with server rules and corrupted stored lists are harmless',()=>{
 const at=Date.parse('2026-10-20T23:59:00+08:00'),sold={kind:'sold_out',reportedAt:at};
 assert.equal(activeReports([sold],at).length,1);assert.equal(activeReports([sold],at+60000).length,0);
 assert.equal(activeReports([{...sold,kind:'not_sold'}],at+7*86400000).length,0);
 assert.deepEqual(activeReports({}),[]);assert.deepEqual(activeReports([null,{kind:'sold_out',reportedAt:NaN}]),[]);
});
test('store selection waits for initial account readiness and a blocked change cannot display a false choice',async()=>{
 const {initStoreControls}=await import('../public/store-controls.js');
 const oldDocument=globalThis.document,oldStorage=globalThis.sessionStorage;
 class Node {constructor(){this.children=[];this.value='';this.dataset={};this.disabled=false;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}closest(){return null;}}
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 globalThis.document={querySelector:get,querySelectorAll:()=>[get('#store-select'),get('#store-query')],createElement:()=>new Node()};
 globalThis.sessionStorage={getItem:()=>null,setItem(){}};
 let busy=true,changes=0;
 const store={id:'s_test',brand:'CoCo都可',name:'測試門市',address:'測試市測試路100號'};
 try{
  const controller=initStoreControls({api:async()=>({results:[store]}),isBusy:()=>busy,setBusy:value=>{busy=value;},onChanged:async()=>{changes++;}});
  assert.equal(get('#store-select').disabled,true);
  assert.equal(get('#store-query').disabled,true);
  await Promise.resolve();busy=false;controller.lock(false);assert.equal(get('#store-select').disabled,false);
  get('#store-select').value=store.id;await get('#store-select').onchange();assert.equal(controller.currentStore().id,store.id);assert.equal(changes,1);
  busy=true;controller.lock(true);get('#store-select').value='';await get('#store-select').onchange();
  assert.equal(controller.currentStore().id,store.id);assert.equal(get('#store-select').value,store.id);assert.equal(changes,1);
 }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=oldStorage;}
});
