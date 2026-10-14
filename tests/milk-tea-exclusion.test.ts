import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {conversationTurn} from '../worker/conversation';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
import {makeEngine,isMilkTea,eligible} from '../worker/recommend';
import {validateInput,understand} from '../worker/understand';
import {milkTeaRetrievalQuery} from '../worker/drink-language';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);
const turn=(message:string,state?:unknown)=>conversationTurn({message,state},brands);

test('milk tea dislikes exclude the category and never become positive retrieval terms',()=>{
 for(const message of ['不喜歡奶茶','我不喜歡奶茶','不喜歡喝奶茶','不愛奶茶','不要奶茶','不喝奶茶','奶茶先不要','奶茶我不喜歡']){
  const a=turn(message);assert.equal(a.state.filters.milkTea,false,message);assert.notEqual(a.state.filters.milk,'none',message);
  assert.ok(!a.state.query.includes('奶茶'),message);assert.equal(a.state.guard,'',message);
  const pool=engine.candidatePool(a.input);assert.ok(pool.length);assert.ok(pool.every(d=>!isMilkTea(d)),message);
  const result=engine.recommendWithTrace(a.input,{scores:catalog.drinks.slice(0,100).map((d,i)=>({id:d.id,score:100-i})),modelVersion:'test',durationMs:1},
   {scores:catalog.drinks.slice(0,100).map((d,i)=>({id:d.id,score:100-i})),modelVersion:'relgt-test',durationMs:1});
  assert.ok(result.response.results.every(p=>p.variants.every(d=>!isMilkTea(d))),message);
 }
 const direct=understand(validateInput({query:'不喜歡奶茶'}),brands);assert.equal(direct.filters.milkTea,false);
 assert.equal(milkTeaRetrievalQuery('不喜歡奶茶',true),'');
 assert.ok(!eligible({...catalog.drinks[0],name:'奶茶三號',milk:[],tea:[]},{milkTea:false}));
 assert.ok(eligible({...catalog.drinks[0],name:'牛奶可可',milk:['鮮奶'],tea:[]},{milkTea:false}));
});

test('negative category persists across turns and repairs old incorrectly positive state',()=>{
 const prior=turn('想喝奶茶，預算80元，不要春水堂');
 const no=turn('我不喜歡奶茶',prior.state);
 assert.equal(no.state.filters.milkTea,false);assert.equal(no.state.filters.maxPrice,80);
 assert.ok(no.state.filters.excludedBrands?.includes('春水堂'));assert.ok(!no.state.query.includes('奶茶'));
 const next=turn('再推薦幾杯',no.state);assert.equal(next.state.filters.milkTea,false);
 const green=turn('不喜歡奶茶，但想喝綠茶');assert.equal(green.state.filters.tea,'綠茶');assert.equal(green.state.filters.milkTea,false);assert.equal(green.state.query,'綠茶');
 const restored=turn('奶茶可以了',no.state);assert.equal(restored.state.filters.milkTea,undefined);assert.equal(restored.state.filters.maxPrice,80);
 const chosen=turn('改喝奶茶',no.state);assert.equal(chosen.state.filters.milkTea,true);
 const legacy=turn('換一批',{query:'不喜歡奶茶',filters:{milkTea:true},guard:''});assert.equal(legacy.state.filters.milkTea,false);assert.equal(legacy.state.query,'');
 const doubleNegative=turn('我不是不喜歡奶茶');assert.notEqual(doubleNegative.state.filters.milkTea,false);
 assert.equal(turn('珍奶不要珍珠').state.filters.milkTea,true);
 assert.equal(turn('不喜歡奶茶，但又想喝奶茶').state.filters.milkTea,false);
});

test('LLM cannot restore disliked milk tea, put it into vectors, or confuse it with no milk',()=>{
 const a=turn('不喜歡奶茶');
 const reply={action:'recommend',query:'濃郁奶茶',filters:{milkTea:true},assistantMessage:'幫你找奶茶',modelVersion:'qwen3-8b-4bit-test',durationMs:1};
 const out=applyLlmUnderstanding(a,reply,brands,[],[])!;
 assert.equal(out.state.filters.milkTea,false);assert.equal(out.state.query,'');assert.equal(out.clarify,true);assert.ok(!out.input.query.includes('奶茶'));assert.ok(out.ack.includes('不喝奶茶'));
 const price=turn('預算80元',out.state);assert.equal(applyLlmUnderstanding(price,reply,brands,[],[])!.state.filters.milkTea,false);
 const notMilk=applyLlmUnderstanding(turn('不要奶茶'),{...reply,filters:{milkTea:false,milk:'none'}},brands,[],[])!;
 assert.notEqual(notMilk.state.filters.milk,'none');
 const allow=applyLlmUnderstanding(turn('奶茶可以了',out.state),reply,brands,[],[])!;
 assert.equal(allow.state.filters.milkTea,undefined);
 assert.ok(!allow.input.query.includes('奶茶'));
 const ask=applyLlmUnderstanding(a,{...reply,action:'clarify',assistantMessage:'你想喝奶茶還是紅茶？'},brands,[],[])!;
 assert.equal(ask.ack,'已設定不喝奶茶，你想喝純茶、果汁，還是其他口味？');
});

test('HTTP passes only positive retrieval text and keeps milk tea exclusion on subsequent batches',{
 skip:!process.env.TEST_BASE_URL
},async()=>{
 const base=process.env.TEST_BASE_URL!;
 const post=async(path:string,body:unknown)=>{
  const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(r.status,200);return await r.json() as {query:string;filters:{milkTea?:boolean};state:unknown;results:Array<{id:string;variants:typeof catalog.drinks}>};
 };
 const manual=await post('/api/recommend',{query:'不喜歡奶茶'});
 assert.equal(manual.query,'');assert.equal(manual.filters.milkTea,false);assert.ok(manual.results.length);
 assert.ok(manual.results.every(p=>p.variants.every(d=>!isMilkTea(d))));
 const chat=await post('/api/chat/recommend',{message:'不喜歡奶茶，但想喝綠茶'});
 assert.equal(chat.filters.milkTea,false);assert.equal(chat.query,'綠茶');assert.ok(chat.results.length);
 assert.ok(chat.results.every(p=>p.variants.every(d=>!isMilkTea(d))));
 const next=await post('/api/chat/recommend',{message:'換一批',state:chat.state,excludedIds:chat.results.map(p=>p.id)});
 assert.equal(next.filters.milkTea,false);assert.ok(next.results.every(p=>p.variants.every(d=>!isMilkTea(d))));
 assert.ok(next.results.every(p=>!chat.results.some(old=>old.id===p.id)));
});
