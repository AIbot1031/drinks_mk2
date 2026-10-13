import {existsSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateSemanticReply} from '../worker/semantic-protocol';
import {makeEngine} from '../worker/recommend';
import {validateInput} from '../worker/understand';
import catalog from '../data/catalog.json';

test('Mac scores cannot bypass candidate filters or inject nonfinite, duplicate or stale values',()=>{
  const job={query:'奶香',candidateIds:['a','b'],catalogVersion:'c',topK:2};
  const reply={modelVersion:'macbert-test',catalogVersion:'c',durationMs:10,scores:[{id:'a',score:.1},{id:'b',score:.8}]};
  assert.equal(validateSemanticReply(reply,job)!.scores[0].id,'b');
  for(const change of [{catalogVersion:'stale'},{scores:[{id:'unknown',score:1}]},{scores:[{id:'a',score:Infinity}]},{scores:[{id:'a',score:1},{id:'a',score:.5}]}])assert.equal(validateSemanticReply({...reply,...change},job),null);
  const engine=makeEngine(catalog.drinks),input=validateInput({query:'清爽',filters:{milk:'none'},limit:6});
  const pool=engine.candidatePool(input);
  const {response,trace}=engine.recommendWithTrace(input,{scores:pool.slice(0,100).map((d,i)=>({id:d.id,score:1-i/100})),modelVersion:'macbert-test',durationMs:10});
  assert.equal(response.mode.routeA,'macbert');assert.ok(response.results.every(r=>r.drink.noMilk));
  assert.equal(trace.routeA.modelVersion,'macbert-test');
  const fallback=engine.recommendWithTrace(input,{scores:[],modelVersion:'',durationMs:0,fallbackReason:'offline'});
  assert.equal(fallback.response.mode.routeA,'tf-idf');assert.equal(fallback.trace.routeA.fallbackReason,'offline');
});


test('Qwen service credential cannot use training export or MacBERT role',{skip:!process.env.TEST_BASE_URL||!existsSync('.llm-key')},async()=>{
 const base=process.env.TEST_BASE_URL!;const key=readFileSync('.llm-key','utf8').trim();
 for(const [path,status] of [['/api/training/events',401],['/api/semantic/connect',401],['/api/semantic/connect?role=llm',426]] as const){
  const response=await fetch(base+path,{headers:{Authorization:'Bearer '+key}});assert.equal(response.status,status);
 }
});
