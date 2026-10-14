import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {conversationTurn} from '../worker/conversation';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
import {makeEngine,eligible} from '../worker/recommend';
import {flavorQuery} from '../worker/numeric-language';
import {validateInput} from '../worker/understand';
import catalog from '../data/catalog.json';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);
const tea=[...new Set(catalog.drinks.flatMap(d=>d.tea))],toppings=[...new Set(catalog.drinks.flatMap(d=>d.toppings))];
const turn=(message:string,state?:unknown)=>conversationTurn({message,state},brands);
const reply=(query:string,filters:unknown)=>({action:'recommend',query,filters,modelVersion:'qwen3.5-9b-4bit-test',durationMs:1});

test('mixed sentences put numbers in filters and leave a positive flavour query regardless of clause order',()=>{
  for(const message of ['清爽回甘，咖啡因50mg以下，預算80元','我想喝清爽奶茶咖啡因不要超過50mg預算80元','咖啡因含量50以下，想喝果香酸甜的飲料','我想喝咖啡因在50以下的清爽茶','想喝果香飲料，咖啡因要在50mg以下，預算不要超過80元']){
    const a=turn(message);assert.equal(a.followUp,undefined,message);assert.equal(a.state.filters.maxCaffeine,50,message);assert.ok(/清爽|果香/.test(a.state.query),message);assert.ok(!/咖啡因|預算|mg|50|80/.test(a.state.query),message);
    const r=engine.recommend(a.input);assert.ok(r.results.every(d=>d.variants.every(v=>eligible(v,r.filters))));
  }
});

test('a Qwen query containing conditions is cleaned without allowing its numbers to alter verified caps',()=>{
  const a=turn('清爽回甘，咖啡因50mg以下，預算80元');
  for(const query of ['清爽回甘，咖啡因50mg以下，預算80元','咖啡因含量要在999mg以下的清爽回甘茶，預算5元','咖啡因50mg以下']){
    const b=applyLlmUnderstanding(a,reply(query,{maxCaffeine:999,maxPrice:5}),brands,tea,toppings)!;
    assert.equal(b.state.filters.maxCaffeine,50);assert.equal(b.state.filters.maxPrice,80);assert.ok(/清爽|回甘/.test(b.state.query));assert.ok(!/咖啡因|預算|mg|\d/.test(b.state.query));
    const c=turn('預算提高到120元',b.state);assert.equal(c.state.filters.maxPrice,120);assert.equal(engine.recommend(c.input).filters.maxPrice,120);
  }
});

test('low caffeine and calories become disclosed caps with flavour remaining in any position',()=>{
  for(const message of ['低咖啡因的清爽茶，預算60元','我想喝清爽回甘但低咖啡因，預算六十','低熱量的果香飲料']){
    const a=turn(message);assert.equal(a.followUp,undefined);assert.ok(/清爽|果香/.test(a.state.query));assert.ok(!/咖啡因|熱量/.test(a.state.query));
    if(message.includes('低咖啡因')){assert.equal(a.state.filters.maxCaffeine,100);assert.ok(a.warnings.some(w=>w.includes('100 mg')));}
    else {assert.equal(a.state.filters.maxCalories,200);assert.ok(a.warnings.some(w=>w.includes('200 kcal')));}
  }
  const explicit=turn('低咖啡因的清爽茶，咖啡因30以下');assert.equal(explicit.state.filters.maxCaffeine,30);assert.ok(!explicit.warnings.some(w=>w.includes('100 mg')));
});

test('a stale condition in legacy flavour text is repaired and never overrides a new cap or its release',()=>{
  const legacy={query:'清爽回甘，咖啡因50mg以下，預算80元',filters:{maxCaffeine:50,maxPrice:80},guard:''};
  const a=turn('預算120元',legacy);assert.equal(a.state.filters.maxPrice,120);assert.equal(engine.recommend(a.input).filters.maxPrice,120);assert.equal(a.state.query,'清爽回甘');
  const b=turn('咖啡因不限',a.state);assert.equal(b.state.filters.maxCaffeine,undefined);assert.ok(!/咖啡因/.test(b.state.query));
  const recovered=turn('再推薦幾杯',{...legacy,filters:{}});assert.equal(recovered.state.filters.maxCaffeine,50);assert.equal(recovered.state.filters.maxPrice,80);assert.equal(recovered.state.query,'清爽回甘');
});

test('invalid mixed conditions retain flavour through a pending question; allergy restrictions still block',()=>{
  const a=turn('咖啡因少於零的清爽綠茶');assert.ok(a.followUp);assert.ok(a.state.query.includes('清爽'));assert.equal(a.state.filters.tea,'綠茶');
  const b=turn('零',a.state);assert.equal(b.state.filters.maxCaffeine,0);assert.equal(b.state.query,a.state.query);assert.equal(b.state.filters.tea,'綠茶');
  for(const message of ['清爽茶，咖啡因含量50以下，花生過敏','清爽咖啡因未知花生過敏','咖啡因大於五十不要珍珠的清爽綠茶','咖啡因50到100mg不要珍珠的清爽茶']){const c=turn(message);if(message.includes('過敏')){assert.equal(engine.recommend(c.input).blocked,true);assert.equal(engine.recommend(turn('咖啡因50',c.state).input).blocked,true);}else{assert.ok(c.followUp);assert.deepEqual(c.state.filters.excludedToppings,['珍珠']);assert.ok(c.state.query.includes('清爽'));}}
});

test('manual retrieval removes numeric text only after hard filters and blocking conditions are understood',()=>{
  const {response,trace}=engine.recommendWithTrace(validateInput({query:'清爽回甘 咖啡因50mg以下 80元內'}));
  assert.equal(response.filters.maxCaffeine,50);assert.equal(response.filters.maxPrice,80);assert.ok(!/咖啡因|mg|80/.test(response.query));assert.ok(trace.routeA.ranked.every(row=>engine.candidatePool(validateInput({query:'清爽',filters:response.filters})).some(d=>d.id===row.id)));
  assert.equal(engine.recommend(validateInput({query:'咖啡因少於零的清爽茶'})).blocked,true);
  assert.equal(flavorQuery('50嵐清爽綠茶，預算80元'),'50嵐清爽綠茶');
});

test('HTTP keeps numeric text out of the returned query even if a Qwen role sends a mixed query',{
  skip:!process.env.TEST_BASE_URL||!['127.0.0.1','localhost'].includes(new URL(process.env.TEST_BASE_URL).hostname)||!existsSync('.llm-key')
},async()=>{
  const base=process.env.TEST_BASE_URL!,WebSocket=createRequire(import.meta.url)('ws');
  const socket=new WebSocket(base.replace(/^http/,'ws')+'/api/semantic/connect?role=llm',{headers:{Authorization:'Bearer '+readFileSync('.llm-key','utf8').trim()}});
  socket.on('message',(data:Buffer)=>{const job=JSON.parse(data.toString());if(job.type==='chat')socket.send(JSON.stringify({type:'result',id:job.id,result:reply('清爽回甘，咖啡因50mg以下，預算80元',job.state.filters)}));});
  try{
    await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    socket.send(JSON.stringify({type:'ready',modelVersion:'qwen3.5-9b-4bit-test',catalogVersion:createHash('sha256').update(readFileSync('data/catalog.json')).digest('hex'),device:'mlx'}));
    for(let i=0;i<20;i++){const s=await fetch(base+'/api/semantic/status').then(r=>r.json()) as any;if(s.llm?.ready)break;await new Promise(r=>setTimeout(r,30));}
    const r=await fetch(base+'/api/chat/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'清爽回甘，咖啡因含量要在50mg以下，預算80元'})});assert.equal(r.status,200);
    const v=await r.json() as any;assert.equal(v.chatMode,'qwen3.5-9b');assert.equal(v.filters.maxCaffeine,50);assert.equal(v.filters.maxPrice,80);assert.ok(!/咖啡因|預算|mg|\d/.test(v.query));assert.ok(!/咖啡因|預算|mg|\d/.test(v.state.query));assert.ok(v.results.every((d:any)=>d.variants.every((n:any)=>n.caffeineMax!==null&&n.caffeineMax<=50&&n.price<=80)));
  }finally{socket.terminate();}
});
