import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import catalog from '../data/catalog.json';
import directory from '../data/nidin-directory.json';
import {feedbackInput} from '../worker/quick-feedback';
const input=()=>({id:crypto.randomUUID(),reporterId:crypto.randomUUID(),kind:'region',message:'  本機測試：請核對地區品牌  ',region:{city:'雲林縣',district:'虎尾鎮'}});
test('quick reports accept only bounded text and verified catalog/region context',()=>{
 const v=input(),parsed=feedbackInput({...v,drinkId:catalog.drinks[0].id,untrusted:'ignored'},catalog.drinks);
 assert.equal(parsed.message,v.message.trim());assert.equal(parsed.context.brand,catalog.drinks[0].brand);
 assert.equal('untrusted' in parsed.context,false);
 for(const patch of [{message:''},{message:'x'.repeat(1001)},{kind:'fake'},{id:'x'},{reporterId:'x'},{drinkId:'missing'},{region:{city:'不存在'}},{traceId:'fake'}])assert.throws(()=>feedbackInput({...v,...patch},catalog.drinks));
});
const base=process.env.TEST_BASE_URL;
test('area brand API lists only the chosen area, county is optional, and general restores 41 brands',{skip:!base},async()=>{
 const scope=await fetch(`${base}/api/regions?`+new URLSearchParams({city:'雲林縣',district:'虎尾鎮'})).then(r=>r.json()) as {brands:string[]};
 const expected=[...new Set(directory.stores.filter(s=>s.city==='雲林縣'&&s.district==='虎尾鎮').map(s=>s.brand))].sort();
 assert.deepEqual(scope.brands,expected);assert.ok(scope.brands.includes('CoCo都可'));
 const county=await fetch(`${base}/api/regions?`+new URLSearchParams({city:'雲林縣'})).then(r=>r.json()) as {brands:string[]};
 assert.ok(expected.every(b=>county.brands.includes(b)));
 const general=await fetch(`${base}/api/regions`).then(r=>r.json()) as {brands:string[]};assert.equal(general.brands.length,41);
 assert.equal((await fetch(`${base}/api/regions?city=invalid`)).status,400);
});
test('public quick report appears only in authenticated team review and can be resolved',{skip:!base||!process.env.TEST_REVIEW_KEY},async()=>{
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const body=input(),response=await post('/api/reports/quick',body);assert.equal(response.status,200);
 assert.equal((await post('/api/reports/quick',body)).status,200);
 assert.equal((await post('/api/reports/quick',{...body,id:crypto.randomUUID(),message:''})).status,400);
 assert.equal((await post('/api/reports/quick',input(),{Origin:'https://unrelated.example'})).status,403);
 assert.equal((await fetch(base+'/api/internal/feedback')).status,401);
 assert.equal((await post('/api/internal/feedback/review',{id:body.id,status:'resolved'})).status,401);
 const login=await post('/api/internal/login',{id:JSON.parse(readFileSync('wrangler.jsonc','utf8')).vars.REVIEW_ID,password:process.env.TEST_REVIEW_KEY});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const list=await fetch(base+'/api/internal/feedback',{headers:{cookie}}).then(r=>r.json()) as {results:Array<{id:string;message:string;context:{region:{city:string}};reporter_hash?:string}>};
 const saved=list.results.find(r=>r.id===body.id)!;assert.ok(saved);assert.equal(saved.message,body.message.trim());assert.equal(saved.context.region.city,'雲林縣');assert.equal(saved.reporter_hash,undefined);
 assert.equal((await post('/api/internal/feedback/review',{id:body.id,status:'invalid'},{cookie})).status,400);
 assert.equal((await post('/api/internal/feedback/review',{id:body.id,status:'resolved'},{cookie})).status,200);
 const after=await fetch(base+'/api/internal/feedback',{headers:{cookie}}).then(r=>r.json()) as {results:Array<{id:string}>};assert.ok(after.results.every(r=>r.id!==body.id));
});
