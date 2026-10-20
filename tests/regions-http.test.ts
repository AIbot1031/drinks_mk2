import assert from 'node:assert/strict';
import {test} from 'node:test';
const base=process.env.TEST_BASE_URL;
const post=async(path:string,body:unknown)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
test('Huwei CoCo rejects Taoyuan variants in manual, chat and preference refresh',{skip:!base},async()=>{
 const region={city:'雲林縣',district:'虎尾鎮'},scope={searchMode:'region',region};
 const first=await post('/api/recommend',{...scope,query:'3Q奶茶',filters:{brand:'CoCo都可',toppings:['芋圓']}});
 assert.equal(first.status,200);assert.equal(first.data.results.length,0);assert.equal(first.data.alternatives.length,0);
 const chat=await post('/api/chat/recommend',{...scope,message:'想喝CoCo都可3Q奶茶加芋圓'});
 assert.equal(chat.status,200);assert.equal(chat.data.results.length,0);
 const refresh=await post('/api/preference-refresh',{...scope,rankingContext:first.data.rankingContext});
 assert.equal(refresh.status,200);assert.equal(refresh.data.results.length,0);
 const county=await post('/api/recommend',{query:'',searchMode:'region',region:{city:'雲林縣'},filters:{brand:'CoCo都可'}});
 assert.equal(county.status,200);assert.ok(county.data.results.length);
 assert.ok(county.data.results.every((r:any)=>r.variants.every((d:any)=>d.sourceKind==='nidin'&&d.regionKeys.some((key:string)=>key.startsWith('雲林縣|')))));
 const local=await post('/api/recommend',{query:'',...scope,filters:{brand:'CoCo都可'}});
 assert.equal(local.status,200);assert.ok(local.data.results.length);
 for(const r of local.data.results)for(const d of r.variants){assert.equal(d.region,'雲林縣虎尾鎮');assert.equal(d.sourceUrl,'https://order.nidin.shop/menu/23257');assert.equal(d.price,null);}
});
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
