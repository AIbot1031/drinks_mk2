import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {validateInput,understand} from '../worker/understand';
import {eligible,makeEngine} from '../worker/recommend';
import {conversationTurn} from '../worker/conversation';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
import {requiredToppings} from '../worker/drink-language';
import type {Drink} from '../worker/types';
const drinks:Drink[]=catalog.drinks,engine=makeEngine(drinks),brands=Object.keys(catalog.brands);
const turn=(message:string,state?:ReturnType<typeof conversationTurn>['state'])=>conversationTurn({message,state},brands);

test('multiple topping inputs validate, deduplicate aliases and retain scalar compatibility',()=>{
  assert.deepEqual(requiredToppings(validateInput({query:'',filters:{topping:'珍珠',toppings:['波霸','布丁','布丁']}}).filters),['珍珠','布丁']);
  assert.equal(validateInput({query:'',filters:{toppings:['珍珠']}}).filters.topping,'珍珠');
  assert.equal(validateInput({query:'',filters:{topping:'珍珠'}}).filters.topping,'珍珠');
  for(const toppings of [null,'珍珠',[5],['未知配料'],Array(21).fill('珍珠')])assert.throws(()=>validateInput({query:'',filters:{toppings}}));
});
test('any selected topping is accepted in both recommendation batches and all cup variants',()=>{
  const input=validateInput({query:'',filters:{toppings:['珍珠','布丁']},limit:20});
  const first=engine.recommend(input);assert.ok(first.results.length);
  const onlyPearl=drinks.find(d=>d.toppings.includes('珍珠')&&!d.toppings.includes('布丁'))!;
  const onlyPudding=drinks.find(d=>d.toppings.includes('布丁')&&!d.toppings.includes('珍珠'))!;
  assert.equal(eligible(onlyPearl,input.filters),true);assert.equal(eligible(onlyPudding,input.filters),true);
  const second=engine.recommend({...input,excludedIds:first.results.map(r=>r.id)});
  for(const result of [first,second])for(const r of result.results)for(const d of r.variants)assert.ok(d.toppings.includes('珍珠')||d.toppings.includes('波霸')||d.toppings.includes('布丁'));
  assert.ok(second.results.every(r=>!first.results.some(old=>old.id===r.id)));
});
test('text understands several toppings and rejects selection/exclusion conflicts',()=>{
  const understood=understand(validateInput({query:'要珍珠、布丁和椰果'}),brands);
  assert.deepEqual(new Set(requiredToppings(understood.filters)),new Set(['珍珠','布丁','椰果']));
  const conflict=understand(validateInput({query:'不要波霸',filters:{toppings:['珍珠','布丁']}}),brands);
  assert.equal(conflict.blocked,true);
});
test('conversation can add, remove one, replace and clear multiple toppings',()=>{
  const initial=turn('我要珍珠和布丁奶茶');assert.deepEqual(new Set(requiredToppings(initial.state.filters)),new Set(['珍珠','布丁']));assert.equal(initial.state.query,'奶茶');
  const added=turn('再加椰果',initial.state);assert.equal(requiredToppings(added.state.filters).length,3);
  assert.equal(requiredToppings(turn('加椰果',initial.state).state.filters).length,3);
  const removed=turn('不要珍珠',added.state);assert.deepEqual(new Set(requiredToppings(removed.state.filters)),new Set(['布丁','椰果']));
  const allowed=turn('珍珠可以了',removed.state);assert.deepEqual(requiredToppings(allowed.state.filters),requiredToppings(removed.state.filters));
  const replaced=turn('配料改成仙草',allowed.state);assert.deepEqual(requiredToppings(replaced.state.filters),['仙草']);
  const cleared=turn('配料不限',added.state);assert.deepEqual(requiredToppings(cleared.state.filters),[]);
  const legacy=turn('配料不限',{...initial.state,query:'珍珠布丁奶茶'});
  assert.deepEqual(requiredToppings(engine.recommend(legacy.input).filters),[]);
  assert.deepEqual(requiredToppings(turn('再看一批',removed.state).state.filters),requiredToppings(removed.state.filters));
});
test('legacy single-topping model output cannot shrink a verified multi-topping request',()=>{
  const original=turn('想喝珍珠布丁奶茶');
  const model={query:'奶茶',filters:{topping:'珍珠'},modelVersion:'qwen3.5-9b-4bit-test',durationMs:1};
  const out=applyLlmUnderstanding(original,model,brands,['紅茶'],['珍珠','布丁','椰果'])!;
  assert.deepEqual(requiredToppings(out.state.filters),requiredToppings(original.state.filters));assert.ok(out.ack.includes('珍珠、布丁'));
  const verbose=applyLlmUnderstanding(original,{...model,query:'珍珠布丁奶茶'},brands,['紅茶'],['珍珠','布丁'])!;
  assert.equal(verbose.state.query,'奶茶');
  const removed=turn('不要珍珠',verbose.state);assert.deepEqual(requiredToppings(engine.recommend(removed.input).filters),['布丁']);
  const invented=applyLlmUnderstanding(original,{...model,filters:{toppings:['珍珠','椰果']}},brands,['紅茶'],['珍珠','布丁','椰果'])!;
  assert.deepEqual(requiredToppings(invented.state.filters),requiredToppings(original.state.filters));
});

const base=process.env.TEST_BASE_URL;
test('HTTP recommendations accept any selected topping and reject malformed arrays',{skip:!base},async()=>{
  const post=(filters:unknown,excludedIds:string[]=[])=>fetch(`${base}/api/recommend`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'',filters,excludedIds})});
  const first=await (await post({toppings:['珍珠','布丁']})).json() as ReturnType<typeof engine.recommend>;
  assert.ok(first.results.length);assert.deepEqual(first.filters.toppings,['珍珠','布丁']);
  const second=await (await post({toppings:['珍珠','布丁']},first.results.map(r=>r.id))).json() as typeof first;
  for(const response of [first,second])for(const r of response.results)for(const d of r.variants)assert.ok(d.toppings.includes('珍珠')||d.toppings.includes('波霸')||d.toppings.includes('布丁'));
  assert.equal((await post({toppings:'珍珠'})).status,400);
});

test('more matching toppings outrank model scores and brand diversity, including past candidate cutoff',()=>{
  const seed=drinks[0];
  const items:Drink[]=Array.from({length:110},(_,i)=>({...seed,id:`single-${i}`,name:`單料${i}`,brand:'單料品牌',toppings:['珍珠']}));
  for(let i=0;i<4;i++)items.push({...seed,id:`both-${i}`,name:`雙料${i}`,brand:'雙料品牌',toppings:['波霸','布丁']});
  items.push({...seed,id:'neither',name:'無料',toppings:[]});
  const local=makeEngine(items),input=validateInput({query:'茶',filters:{toppings:['珍珠','波霸','布丁']},limit:6});
  const scores=items.map((d,i)=>({id:d.id,score:1000-i}));
  const {response}=local.recommendWithTrace(input,{scores,modelVersion:'roberta-wwm-test',durationMs:1},{scores,modelVersion:'relgt-test',durationMs:1});
  assert.deepEqual(response.results.slice(0,4).map(r=>r.name),['雙料0','雙料1','雙料2','雙料3']);
  assert.ok(response.results.slice(4).every(r=>r.name.startsWith('單料')));
  assert.ok(!response.results.some(r=>r.name==='無料'));
  assert.ok(response.results[0].reasoning.includes('2/2'));
  assert.equal(eligible({...seed,toppings:['珍珠','布丁']},{toppings:['珍珠','布丁'],excludedToppings:['布丁']}),false);
  assert.equal(eligible({...seed,toppings:['珍珠'],price:90,priceEstimated:false},{toppings:['珍珠','布丁'],maxPrice:80}),false);
});
