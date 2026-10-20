import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {loadingIngredients,initBrewLoading} from '../public/brew-loading.js';
test('brewing uses selected toppings, chat hints and ingredient exclusions without modifying requests',()=>{
 const body={filters:{toppings:['珍珠','布丁'],excludedToppings:['椰果']},message:'椰果奶茶'};
 const before=JSON.stringify(body);
 assert.deepEqual(loadingIngredients(body),['珍珠','布丁']);
 assert.equal(JSON.stringify(body),before);
 assert.deepEqual(loadingIngredients({state:{filters:{toppings:['珍珠','布丁']}},message:'不要珍珠'}),['布丁']);
 assert.deepEqual(loadingIngredients({message:'想要仙草和芋圓'}),['仙草','芋圓']);
 assert.deepEqual(loadingIngredients({}),[]);
});
test('overlapping requests keep brewing until the final request finishes; completion and failure share cleanup',()=>{
 const previous=globalThis.document;
 class Node{
  children=[];dataset={};style={setProperty(){}};hidden=false;textContent='';
  setAttribute(){} append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;}
 }
 const body=new Node();globalThis.document={createElement:()=>new Node(),body};
 try{
  const brew=initBrewLoading(),root=body.children[0];assert.equal(root.hidden,true);
  const first=brew.start({filters:{toppings:['布丁']}}),second=brew.start({filters:{toppings:['珍珠']}});
  assert.equal(root.hidden,false);assert.match(root.children[2].textContent,/珍珠/);
  brew.stop(first);assert.equal(root.hidden,false);
  brew.stop(second);assert.equal(root.hidden,true);
  assert.equal(root.children[0].children[0].children.length,0);
  const failure=brew.start({});try{throw Error('network failure');}catch{}finally{brew.stop(failure);}
  assert.equal(root.hidden,true);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
 const source=readFileSync('public/app.js','utf8');
 assert.match(source,/finally\{if\(loading\)brewLoading.stop\(loading\);\}/);
 assert.match(readFileSync('public/brew-loading.css','utf8'),/prefers-reduced-motion:reduce/);
});
