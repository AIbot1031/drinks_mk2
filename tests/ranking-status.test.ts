import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {makeEngine} from '../worker/recommend';
import {validateInput} from '../worker/understand';
import {semanticFailureReason,validateSemanticReply} from '../worker/semantic-protocol';
import {rankingStatus} from '../public/ranking-status.js';
const engine=makeEngine(catalog.drinks);
test('empty candidate states never claim TF-IDF, RoBERTa, graph or RelGT execution, including reused ranks',()=>{
 const semantic={scores:[{id:catalog.drinks[0].id,score:.7}],modelVersion:'roberta-wwm-test',durationMs:1};
 const relgt={...semantic,modelVersion:'relgt-temporal-test',historyCount:1};
 for(const filters of [{maxPrice:0},{brand:'not-a-collected-brand'}]){
  const input=validateInput({query:'',filters});
  for(const reused of [true,false]){
   const {response,trace}=engine.recommendWithTrace(input,semantic,relgt,reused);
   assert.equal(response.eligibleCount,0);assert.equal(response.mode.rankingStatus,'not-run');
   for(const path of ['routeA','routeB'] as const){assert.equal(response.mode[path],'not-run');assert.equal(trace[path].executionStatus,'not-run');assert.equal(trace[path].modelVersion,null);assert.equal(trace[path].fallbackReason,null);}
   assert.equal(rankingStatus(response),'沒有符合候選，未執行模型排序。');
  }
 }
});
test('real semantic failures remain labelled fallbacks while healthy candidates use actual model identity',()=>{
 const input=validateInput({query:''}),pool=engine.candidatePool(input);
 for(const reason of ['model_not_ready','catalog_mismatch','model_busy','no_valid_response','invalid_reply']){
  const {response}=engine.recommendWithTrace(input,{scores:[],modelVersion:'',durationMs:0,fallbackReason:reason});
  assert.equal(response.mode.routeA,'tf-idf');assert.match(rankingStatus(response),/備援.*原因/);
 }
 const response=engine.recommendWithTrace(input,{scores:pool.slice(0,100).map(d=>({id:d.id,score:.5})),modelVersion:'roberta-wwm-test',durationMs:1}).response;
 assert.equal(response.mode.routeA,'roberta-wwm');assert.match(rankingStatus(response),/RoBERTa/);
 const job={query:'',candidateIds:[pool[0].id],catalogVersion:'current',topK:1};
 for(const patch of [{catalogVersion:'old'},{scores:[{id:'foreign',score:1}]},{scores:[]},{scores:[{id:pool[0].id,score:NaN}]}]){
  const raw={catalogVersion:'current',scores:[{id:pool[0].id,score:1}],modelVersion:'roberta-wwm-test',durationMs:1,...patch};
  assert.equal(validateSemanticReply(raw,job),null);assert.equal(semanticFailureReason(raw),'invalid_reply');
 }
});
