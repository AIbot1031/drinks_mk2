import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac} from 'node:crypto';
import {anonymousRelgtUser,validateRelgtReply} from '../worker/relgt-protocol';
import {makeEngine} from '../worker/recommend';
import {validateInput} from '../worker/understand';
import catalog from '../data/catalog.json';

test('RelGT identity matches training HMAC and validates history metadata and candidate membership',async()=>{
  const key='ab'.repeat(32),id='synthetic-user';
  assert.equal(await anonymousRelgtUser(id,key),'u_'+createHmac('sha256',Buffer.from(key,'hex')).update(id).digest('hex'));
  await assert.rejects(anonymousRelgtUser(id,'invalid'));
  const job={userCode:'u_'+'a'.repeat(64),at:100,history:[{drinkId:'old',action:'like' as const,occurredAt:50}],candidateIds:['a','b'],catalogVersion:'v',topK:2};
  const reply={scores:[{id:'a',score:7},{id:'b',score:-4}],modelVersion:'relgt-temporal-'+'a'.repeat(16),catalogVersion:'v',durationMs:1,historyCount:1};
  assert.ok(validateRelgtReply(reply,job)); // RelGT outputs logits, not cosine.
  for(const change of [{catalogVersion:'stale'},{historyCount:2},{scores:[{id:'foreign',score:1}]},{scores:[{id:'a',score:NaN}]},{scores:[{id:'a',score:1},{id:'a',score:2}]},{fallbackReason:'new_user'}])assert.equal(validateRelgtReply({...reply,...change},job),null);
  assert.equal(validateRelgtReply({...reply,scores:[],fallbackReason:'new_user'},job)?.fallbackReason,'new_user');
});

test('RelGT replaces B, contributes exact RRF ranks and cannot bypass filters or dislikes',()=>{
  const engine=makeEngine(catalog.drinks);
  const first=engine.candidatePool(validateInput({query:'奶香'})).find(d=>d.brand==='春水堂')!;
  const input=validateInput({query:'奶香',filters:{excludedBrands:['春水堂'],maxPrice:100},dislikedIds:[first.id]});
  const pool=engine.candidatePool(input);assert.ok(pool.length);
  const reply={scores:[{id:first.id,score:999},...pool.slice(0,20).map((d,i)=>({id:d.id,score:20-i}))],modelVersion:'relgt-temporal-'+'a'.repeat(16),durationMs:2,historyCount:3};
  const {response,trace}=engine.recommendWithTrace(input,undefined,reply);
  assert.equal(response.mode.routeB,'relgt');assert.equal(response.mode.routeBModel,reply.modelVersion);
  assert.ok(response.results.length);assert.equal(trace.routeB.seeds.length,0);
  assert.ok(trace.routeB.ranked.every(d=>d.brand!=='春水堂'));
  assert.ok(response.results.every(d=>d.brand!=='春水堂'&&d.variants.every(v=>v.price!==null&&!v.priceEstimated&&v.price<=100)));
  for(const r of trace.fusion.ranked)if(r.rankB!==null)assert.equal(r.contributionB,.35/(60+r.rankB));
  const base=engine.recommendWithTrace(input).response;
  for(const reason of ['guest','no_history','new_user','offline']){
    const fallback=engine.recommendWithTrace(input,undefined,{scores:[],modelVersion:'',durationMs:0,fallbackReason:reason}).response;
    assert.equal(fallback.mode.routeB,'feature-graph');assert.deepEqual(fallback.results,base.results);
  }
  const next=engine.recommendWithTrace({...input,excludedIds:response.results.map(d=>d.id)},undefined,reply).response;
  assert.ok(next.results.every(d=>!response.results.some(old=>old.id===d.id)));
});
