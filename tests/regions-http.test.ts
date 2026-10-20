import assert from 'node:assert/strict';
import {test} from 'node:test';
const base=process.env.TEST_BASE_URL;
const post=async(path:string,body:unknown)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
test('real Worker enforces region across direct, chat and preference refresh; general mode clears stale area',{skip:!base},async()=>{
 const region={city:'雲林縣',district:'虎尾鎮'};
 const stores=await (await fetch(base+'/api/stores?city='+encodeURIComponent(region.city)+'&district='+encodeURIComponent(region.district))).json() as any;
 const brands=new Set(stores.results.map((s:any)=>s.brand));assert.ok(brands.size);
 const first=await post('/api/recommend',{query:'',filters:{maxPrice:70},searchMode:'region',region});assert.equal(first.status,200);assert.deepEqual(first.data.region,region);assert.ok(first.data.results.length);
 assert.ok(first.data.results.every((r:any)=>brands.has(r.brand)&&r.variants.every((d:any)=>brands.has(d.brand))));assert.equal(first.data.alternatives.length,0);
 const refreshed=await post('/api/preference-refresh',{rankingContext:first.data.rankingContext,searchMode:'region',region,dislikedIds:[first.data.results[0].id]});assert.equal(refreshed.status,200);assert.ok(refreshed.data.rankingReused);assert.ok(refreshed.data.results.every((r:any)=>brands.has(r.brand)&&r.name!==first.data.results[0].name||brands.has(r.brand)&&r.brand!==first.data.results[0].brand));
 const chat=await post('/api/chat/recommend',{message:'預算70元',searchMode:'region',region});assert.equal(chat.status,200);assert.ok(chat.data.results.every((r:any)=>brands.has(r.brand)));assert.deepEqual(chat.data.region,region);
 for(const bad of [{searchMode:'region'},{searchMode:'region',region:{city:'雲林縣',district:'不存在'}},{searchMode:'invalid'}])assert.equal((await post('/api/recommend',{query:'',...bad})).status,400);
 const general=await post('/api/recommend',{query:'',searchMode:'general',region:{city:'不存在',district:'不存在'},store:{brand:'fake'}});assert.equal(general.status,200);assert.equal(general.data.region,null);assert.equal(general.data.store,null);
 const empty=await post('/api/recommend',{query:'',filters:{maxPrice:0},searchMode:'region',region});assert.equal(empty.data.results.length,0);assert.equal(empty.data.alternatives.length,0);
});
