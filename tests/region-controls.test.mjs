import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scopeBody} from '../public/region-controls.js';
import {initRegionControls} from '../public/region-controls.js';
test('general mode explicitly clears old store, region and reports; region requires city while district is optional',()=>{
 assert.deepEqual(scopeBody('general','雲林縣','虎尾鎮'),{searchMode:'general',region:null,store:null,storeReports:[]});
 assert.throws(()=>scopeBody('region','',''));
 assert.equal(scopeBody('region','雲林縣','').region.district,'');
 assert.deepEqual(scopeBody('region','雲林縣','虎尾鎮'),{searchMode:'region',region:{city:'雲林縣',district:'虎尾鎮'},store:null,storeReports:[]});
});
test('completing area selection clears the incomplete-area prompt before the first search',async()=>{
 const previousDocument=globalThis.document,previousOption=globalThis.Option;
 class Node{value='';textContent='';hidden=false;replaceChildren(){this.value='';}}
 const nodes=new Map(),get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};
 globalThis.document={querySelector:get,querySelectorAll:()=>[]};globalThis.Option=class{};
 get('#search-scope').value='general';let changes=0;
 try{
  initRegionControls({api:async()=>({regions:[{city:'雲林縣',district:'虎尾鎮'}]}),isBusy:()=>false,onChanged:async()=>{changes++;}});
  await Promise.resolve();get('#search-scope').value='region';await get('#search-scope').onchange();
  assert.match(get('#result-status').textContent,/請先選擇縣市/);
  get('#region-city').value='雲林縣';await get('#region-city').onchange();
  get('#region-district').value='虎尾鎮';await get('#region-district').onchange();
  assert.equal(get('#result-status').textContent,'');assert.equal(changes,2);
  assert.match(get('#region-status').textContent,/雲林縣虎尾鎮/);
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousOption===undefined)delete globalThis.Option;else globalThis.Option=previousOption;}
});
