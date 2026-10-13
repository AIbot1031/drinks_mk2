import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversationTurn} from '../worker/conversation';
import {makeEngine} from '../worker/recommend';
import catalog from '../data/catalog.json';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);
const turn=(message:string,state?:unknown)=>conversationTurn({message,state},brands);

test('chat replaces caps upward, retains taste, and excludes brands across turns',()=>{
  const first=turn('清爽回甘，預算 50 元');
  assert.equal(first.state.filters.maxPrice,50);
  const changed=turn('預算改成 80 元',first.state);
  assert.equal(changed.state.filters.maxPrice,80);
  assert.equal(engine.recommend(changed.input).filters.maxPrice,80);
  assert.equal(changed.state.query,first.state.query);
  const excluded=turn('不要星巴克和50嵐',changed.state);
  assert.deepEqual(excluded.state.filters.excludedBrands,['50嵐','星巴克']);
  const response=engine.recommend(excluded.input);
  assert.ok(response.results.length);
  assert.ok(response.results.every(r=>!excluded.state.filters.excludedBrands!.includes(r.brand)));
  const cleared=turn('預算不限',excluded.state);
  assert.equal(cleared.state.filters.maxPrice,undefined);
  assert.equal(cleared.state.query,first.state.query);
  const bare=turn('80元以內');
  assert.equal(engine.recommend(turn('預算改成100元',bare.state).input).filters.maxPrice,100);
  const evening=turn('晚上');
  assert.equal(engine.recommend(turn('咖啡因不限',evening.state).input).filters.maxCaffeine,undefined);
});
test('chat changes milk preferences without retaining an old no-milk instruction',()=>{
  const a=turn('不要奶');const b=turn('改成鮮奶',a.state);
  assert.equal(b.state.filters.milk,'fresh');
  assert.equal(engine.recommend(b.input).blocked,false);
});
test('chat carries unresolved safety constraints until explicit reset; states are isolated',()=>{
  const a=turn('花生過敏');
  assert.equal(engine.recommend(a.input).blocked,true);
  const b=turn('預算改成60元',a.state);
  assert.equal(engine.recommend(b.input).blocked,true);
  assert.equal(engine.recommend(turn('不要奶蓋').input).blocked,true);
  const reset=turn('重新開始',b.state);
  assert.equal(reset.state.guard,'');assert.deepEqual(reset.state.filters,{});
  assert.equal(turn('想喝清爽茶').state.guard,'');
  assert.equal(turn('再推薦幾杯',b.state).next,true);
  for(const body of [{message:''},{message:'x'.repeat(301)},{message:'hi',state:[]},{message:'hi',state:{filters:{maxPrice:-1}}}])assert.throws(()=>conversationTurn(body,brands));
});
test('chat HTTP persists traces, excludes previous batches and applies same-origin checks',{skip:!process.env.TEST_BASE_URL},async()=>{
  const base=process.env.TEST_BASE_URL!;
  const post=(body:unknown,origin?:string)=>fetch(`${base}/api/chat/recommend`,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  const first=await post({message:'清爽回甘，預算60元'});assert.equal(first.status,200);
  const value=await first.json() as {state:unknown;traceId:string;results:Array<{id:string}>};
  assert.ok(value.traceId);assert.ok(value.results.length);
  const next=await post({message:'再推薦幾杯',state:value.state,excludedIds:value.results.map(r=>r.id)}).then(r=>r.json()) as {next:boolean;results:Array<{id:string}>};
  assert.equal(next.next,true);assert.ok(next.results.every(r=>!value.results.some(old=>old.id===r.id)));
  assert.equal((await post({message:'清爽'},'https://unrelated.example')).status,403);
  assert.equal((await post({message:''})).status,400);
});

test('no pearl is a persistent topping preference and repairs legacy preference guards',()=>{
  const a=turn('我想要喝奶茶不要珍珠');
  assert.equal(a.state.guard,'');assert.equal(a.state.filters.milkTea,true);
  assert.deepEqual(a.state.filters.excludedToppings,['珍珠']);
  const b=turn('不要珍珠',a.state);
  const c=turn('預算改成100元',b.state);
  for(const step of [a,b,c]){
    const response=engine.recommend(step.input);
    assert.equal(response.blocked,false);assert.ok(response.results.length);
    for(const drink of response.results)for(const variant of drink.variants??[drink]){
      assert.ok(!/珍珠|波霸/.test(variant.name));
      assert.ok(!variant.toppings.some(t=>/珍珠|波霸/.test(t)));
    }
  }
  const legacy=turn('不要珍珠',{query:'',filters:{},guard:'忌口：我想要喝奶茶不要珍珠'});
  assert.equal(legacy.state.guard,'');assert.equal(legacy.state.filters.milkTea,true);
  assert.equal(engine.recommend(turn('不要珍珠',turn('花生過敏').state).input).blocked,true);
});
