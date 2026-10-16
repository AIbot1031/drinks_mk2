import {test} from 'node:test';import assert from 'node:assert/strict';
import {traceSummary,listSummary,modelState} from '../public/review-summary.js';
test('review separates clarification, blocked results and real fallback from normal guest behavior',()=>{
 const base={consumerOutput:{results:[]},understanding:{llmAction:'clarify'},routeB:{fallbackReason:'guest'}};
 assert.deepEqual(traceSummary({...base,understanding:{llmAction:'clarify',blocked:true}}).issues.map(i=>i.text),['等待使用者釐清']);
 assert.deepEqual(traceSummary(base).issues.map(i=>i.text),['等待使用者釐清']);
 assert.deepEqual(traceSummary({...base,understanding:{blocked:true}}).issues.map(i=>i.text),['條件被阻擋']);
 assert.ok(traceSummary({...base,understanding:{},routeA:{fallbackReason:'timeout'}}).issues.some(i=>i.text==='A 路徑使用備援'));
 assert.ok(!traceSummary({consumerOutput:{results:[{id:'x'}]},routeB:{fallbackReason:'no_history'}}).issues.length);
});
test('historical traces missing fields stay unknown and summaries describe only loaded rows',()=>{
 assert.equal(traceSummary({input:{query:''}}).query,'只設定篩選條件');
 const s=traceSummary({});assert.equal(s.version,'未記錄');assert.equal(s.routeB,'未記錄');
 assert.deepEqual(listSummary([{result_count:0},{result_count:6},{result_count:1}]),{total:3,withResults:2,empty:1});
 assert.equal(modelState(), '未取得');assert.equal(modelState({connected:true,ready:false}),'已連線・準備中');assert.equal(modelState({connected:true,ready:true}),'就緒');assert.equal(modelState({connected:false,ready:false}),'未連線');
});
