import {test} from 'node:test';import assert from 'node:assert/strict';
const base=process.env.REVIEW_TEST_BASE_URL,id=process.env.REVIEW_TEST_ID,password=process.env.REVIEW_TEST_PASSWORD,key=process.env.TRAINING_SYNC_TEST_KEY;
test('team-only training summaries retain failures and reject raw uploads',{skip:!base||!id||!password||!key},async()=>{
 assert.equal((await fetch(base+'/api/internal/training')).status,401);
 assert.equal((await fetch(base+'/api/training/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const a=await fetch(base+'/api/internal/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,password})});assert.equal(a.status,200);const cookie=a.headers.get('set-cookie').split(';')[0];
 const r=await fetch(base+'/api/internal/training',{headers:{Cookie:cookie}});assert.equal(r.status,200);const {results}=await r.json();assert.ok(results.length);const failed=results.find(r=>r.status==='failed');assert.ok(failed);assert.ok(failed.metrics.every(m=>m.after===null&&m.delta===null));
 const {syncedAt,...sample}=results[0];const invalid=await fetch(base+'/api/training/reports',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({...sample,cookie:'raw-data-must-be-rejected'})});assert.equal(invalid.status,400);
 assert.equal((await fetch(base+'/api/internal/training',{headers:{Cookie:cookie,Origin:'https://example.invalid'}})).status,403);
 await fetch(base+'/api/internal/logout',{method:'POST',headers:{Cookie:cookie}});
});
