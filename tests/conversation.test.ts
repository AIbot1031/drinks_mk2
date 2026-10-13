import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversationTurn} from '../worker/conversation';
import {makeEngine} from '../worker/recommend';
import catalog from '../data/catalog.json';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);
const turn=(message:string,state?:unknown)=>conversationTurn({message,state},brands);

test('brand-first exclusions and allowing one brand preserve user intent',()=>{
  const first=turn('春水堂先排除，預算75元',turn('我想喝奶茶').state);
  assert.equal(first.state.guard,'');assert.ok(first.state.filters.excludedBrands?.includes('春水堂'));assert.equal(first.state.filters.brand,undefined);
  const second=turn('星巴克也不要',first.state);
  assert.equal(second.state.guard,'');assert.ok(second.state.filters.excludedBrands?.includes('星巴克'));assert.ok(second.state.filters.excludedBrands?.includes('春水堂'));
  const allow=turn('春水堂可以了',second.state);
  const parsed=applyLlmUnderstanding(allow,{action:'recommend',query:'奶茶',filters:{brand:'春水堂',milkTea:true,maxPrice:75},modelVersion:'qwen3-8b-4bit-test',durationMs:1},brands,[],[])!;
  assert.equal(parsed.state.filters.brand,undefined);assert.deepEqual(parsed.state.filters.excludedBrands,['星巴克']);assert.equal(parsed.state.filters.maxPrice,75);
});

test('dislike of a topping and tea latte milk requirements are applied before ranking',()=>{
  const disliked=turn('我不喜歡珍珠但想喝奶茶');
  assert.equal(disliked.state.guard,'');assert.equal(disliked.state.filters.topping,undefined);assert.deepEqual(disliked.state.filters.excludedToppings,['珍珠']);
  assert.ok(engine.recommend(disliked.input).results.length);
  for(const text of ['我想喝紅茶拿鐵，預算80元','鮮奶茶，不要奶精']){
    const a=turn(text);assert.equal(a.state.guard,'');assert.equal(a.state.filters.milk,'fresh');
    const r=engine.recommend(a.input);assert.equal(r.blocked,false);assert.ok(r.results.length);
    assert.ok(r.results.every(d=>d.variants.every(v=>v.milk.includes('鮮奶')&&!v.milk.includes('奶精')&&!v.milkConflict)));
  }
});

test('allowing a topping or brand removes only that exclusion and pure tea replaces milk tea',()=>{
  const noPearl=turn('奶茶不要珍珠，預算100元');
  const allowed=turn('珍珠可以了',noPearl.state);
  assert.deepEqual(allowed.state.filters.excludedToppings,[]);assert.equal(allowed.state.filters.topping,undefined);
  assert.equal(allowed.state.filters.maxPrice,100);
  const wrong=applyLlmUnderstanding(allowed,{query:'奶茶',filters:{milkTea:true,excludedToppings:['珍珠'],maxPrice:30},modelVersion:'qwen3-8b-4bit-test',durationMs:1,assistantMessage:'不加珍珠'},brands,[],['珍珠'])!;
  assert.deepEqual(wrong.state.filters.excludedToppings,[]);assert.equal(wrong.state.filters.maxPrice,100);assert.ok(!wrong.ack.includes('不加珍珠'));
  const blocked=turn('不要春水堂和星巴克');
  const allowBrand=turn('春水堂可以了',blocked.state);
  assert.deepEqual(allowBrand.state.filters.excludedBrands,['星巴克']);assert.equal(allowBrand.state.filters.brand,undefined);
  const pure=turn('改喝純紅茶，不要奶茶',noPearl.state);
  assert.equal(pure.state.guard,'');assert.equal(pure.state.filters.milkTea,false);assert.equal(pure.state.filters.milk,'none');assert.equal(pure.state.filters.tea,'紅茶');
  const parsed=applyLlmUnderstanding(pure,{query:'奶茶',filters:{milkTea:true,milk:'fresh'},modelVersion:'qwen3-8b-4bit-test',durationMs:1},brands,['紅茶'],['珍珠'])!;
  const results=engine.recommend(parsed.input);assert.equal(results.blocked,false);assert.ok(results.results.length);assert.ok(results.results.every(d=>d.variants.every(v=>v.noMilk&&v.tea.includes('紅茶'))));
});

test('explicit brand dislike with an explanation excludes that brand through later turns and Qwen output',()=>{
  const prior=turn('春水堂珍奶');
  for(const message of ['我不喜歡春水堂他們都是盤子','我不喜歡春水堂，太貴了','我不愛春水堂','不要春水堂，他們太貴']){
    const excluded=turn(message,prior.state);
    assert.ok(excluded.state.filters.excludedBrands?.includes('春水堂'));
    assert.equal(excluded.state.filters.brand,undefined);
    const parsed=applyLlmUnderstanding(excluded,{query:'春水堂珍珠奶茶',filters:{brand:'春水堂',milkTea:true},modelVersion:'qwen3-8b-4bit-test',durationMs:1},brands,[],[])!;
    assert.ok(parsed);assert.equal(parsed.state.filters.brand,undefined);
    for(const input of [excluded.input,parsed.input,turn('再推薦幾杯',parsed.state).input]){
      const response=engine.recommend(input);
      assert.equal(response.blocked,false);assert.ok(response.results.length);
      assert.ok(response.results.every(drink=>drink.brand!=='春水堂'));
    }
  }
  const direct=engine.recommend({query:'我不喜歡春水堂他們都是盤子',filters:{},likedIds:[],dislikedIds:[],excludedIds:[],limit:6});
  assert.ok(direct.results.length);assert.ok(direct.results.every(drink=>drink.brand!=='春水堂'));
  assert.ok(!turn('我不喜歡春水堂的珍珠奶茶').state.filters.excludedBrands?.includes('春水堂'));
  assert.ok(!turn('我不是不喜歡春水堂').state.filters.excludedBrands?.includes('春水堂'));
  assert.equal(turn('我喜歡春水堂').state.filters.brand,'春水堂');
});

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
  assert.equal(engine.recommend(turn('不要奶蓋').input).blocked,false);
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

test('pearl milk tea shorthand follows the final exclusion and repairs prior blocked turns',()=>{
  for(const message of ['我想要珍奶但是不要珍','珍奶不要珍珠','珍奶但別加珍珠','奶茶不想要珍珠']){
    const a=turn(message);const b=turn('不要珍珠',a.state);
    assert.equal(a.state.guard,'');assert.equal(a.state.filters.milkTea,true);assert.equal(a.state.filters.topping,undefined);
    for(const step of [a,b]){
      const response=engine.recommend(step.input);assert.equal(response.blocked,false);assert.ok(response.results.length);
      for(const r of response.results)for(const variant of r.variants)assert.ok(!/珍珠|波霸/.test(variant.name+' '+variant.toppings.join(' ')));
    }
  }
  const legacy=turn('不要珍珠',{query:'',filters:{topping:'珍珠'},guard:'忌口：我想要珍奶但是不要珍'});
  assert.equal(legacy.state.guard,'');assert.equal(legacy.state.filters.topping,undefined);
  assert.equal(engine.recommend(legacy.input).blocked,false);
  const unknown=engine.recommend(turn('不要神秘配料').input);
  assert.equal(unknown.blocked,true);assert.ok(unknown.warnings.some(w=>w.includes('還沒理解')));assert.ok(!unknown.warnings.some(w=>w.includes('過敏原')));
  const clinical=turn('不要珍珠',{query:'',filters:{},guard:'忌口：我花生過敏，珍奶不要珍'});
  assert.equal(engine.recommend(clinical.input).blocked,true);
});
