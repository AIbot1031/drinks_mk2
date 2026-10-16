import {test} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {validateTrainingSummary} from '../worker/training-summary';
const rows=JSON.parse(execFileSync(process.env.PYTHON??'python3',['scripts/build_training_summaries.py'],{encoding:'utf8'}));
test('actual saved summaries pass the allowlist and preserve missing failed postmetrics',()=>{
 assert.ok(rows.length);for(const r of rows)assert.deepEqual(validateTrainingSummary(r),r);
 const failed=rows.find((r:{status:string})=>r.status==='failed');assert.ok(failed);assert.ok(failed.metrics.every((m:{after:number|null;delta:number|null})=>m.after===null&&m.delta===null));
});
test('dashboard rejects raw payloads, fabricated deltas and model/run mismatches',()=>{
 const r=rows[0];assert.throws(()=>validateTrainingSummary({...r,cookie:'never-upload'}));assert.throws(()=>validateTrainingSummary({...r,model:'RelGT'}));
 assert.throws(()=>validateTrainingSummary({...r,metrics:[{name:'all_intent_exact_rate',before:.9,after:null,delta:0,direction:'higher'}]}));
 assert.throws(()=>validateTrainingSummary({...r,metrics:[{name:'all_intent_exact_rate',before:.9,after:.5,delta:.4,direction:'higher'}]}));
 assert.throws(()=>validateTrainingSummary({...r,metrics:[{name:'raw_user_message',before:0,after:1,delta:1,direction:'higher'}]}));
});
