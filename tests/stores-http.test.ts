import assert from 'node:assert/strict';
import {test} from 'node:test';
const base=process.env.TEST_BASE_URL;
const post=async(path:string,body:unknown,cookie?:string)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return {response,value:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]};};
const branch=()=>({brand:'50嵐',name:'合成測試'+crypto.randomUUID().slice(0,8),address:'合成測試市測試路100號'});
test('report refresh preserves original strict conditions, every cup, preferences and isolation across branches',{skip:!base},async()=>{
 const store=branch(),first=await post('/api/recommend',{query:'',filters:{maxPrice:70,tea:'綠茶'},store});
 assert.equal(first.response.status,200);assert.ok(first.value.results.length);assert.ok(first.value.results.every((r:any)=>r.brand===store.brand&&r.availability.status==='unknown'));
 const target=first.value.results[0],reporterId=crypto.randomUUID(),id=crypto.randomUUID(),reportBody={id,reporterId,store,drinkId:target.id,kind:'sold_out'};
 const report=await post('/api/stores/reports',reportBody);assert.equal(report.response.status,200);assert.equal(report.value.pending,true);
 const retry=await post('/api/stores/reports',reportBody);assert.equal(retry.value.reportedAt,report.value.reportedAt);
 const refresh=await post('/api/preference-refresh',{rankingContext:first.value.rankingContext,store,storeReports:[report.value]});
 assert.equal(refresh.response.status,200);assert.equal(refresh.value.rankingReused,true);assert.deepEqual(refresh.value.filters,first.value.filters);
 assert.equal(refresh.value.mode.livePreferences,false);assert.equal(refresh.value.alternatives.length,0);
 assert.ok(refresh.value.results.every((r:any)=>r.name!==target.name&&r.brand===store.brand&&r.variants.every((d:any)=>d.tea.includes('綠茶')&&d.price<=70&&!d.priceEstimated)));
 const stranger=await post('/api/preference-refresh',{rankingContext:first.value.rankingContext,store});assert.ok(stranger.value.results.some((r:any)=>r.name===target.name));
 const other=await post('/api/preference-refresh',{rankingContext:first.value.rankingContext,store:{...store,name:'另一測試門市'}});assert.ok(other.value.results.some((r:any)=>r.name===target.name));
 const constrained=await post('/api/recommend',{query:'',filters:{maxPrice:0},store});assert.equal(constrained.value.results.length,0);assert.equal(constrained.value.alternatives.length,0);
 const foreign=await post('/api/stores/reports',{...reportBody,id:crypto.randomUUID(),store:{...store,brand:'CoCo都可'}});assert.equal(foreign.response.status,400);
 assert.equal((await fetch(base+'/api/internal/stores/reports')).status,401);
 const cross=await fetch(base+'/api/stores/reports',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify(reportBody)});assert.equal(cross.status,403);
});
test('team review confirms only the reported branch, with evidence and source requirements',{skip:!base||!process.env.TEST_REVIEW_KEY},async()=>{
 const store=branch(),first=await post('/api/recommend',{query:'',store}),d=first.value.results[0];
 const report=await post('/api/stores/reports',{id:crypto.randomUUID(),reporterId:crypto.randomUUID(),store,drinkId:d.id,kind:'not_sold'});
 const login=await post('/api/internal/login',{id:'team001',password:process.env.TEST_REVIEW_KEY});assert.equal(login.response.status,200);
 const cookie=login.cookie!;
 const missing=await post('/api/internal/stores/review',{reportId:report.value.id,status:'not_sold',evidence:'測試查證',verifyStore:true},cookie);assert.equal(missing.response.status,400);
 const reviewed=await post('/api/internal/stores/review',{reportId:report.value.id,status:'not_sold',evidence:'合成測試：不是實際店家供應資訊'},cookie);assert.equal(reviewed.response.status,200);
 const fresh=await post('/api/preference-refresh',{rankingContext:first.value.rankingContext,store});assert.ok(fresh.value.results.every((r:any)=>r.name!==d.name));
 await post('/api/internal/logout',{},cookie);
});
test('official Huwei directory and 3Q research are exposed by the real Worker without claiming absent products are unavailable',{skip:!base},async()=>{
 const {default:huwei}=await import('../data/coco-huwei-store.json');
 const directory=await fetch(base+'/api/stores?q='+encodeURIComponent('虎尾'));assert.equal(directory.status,200);
 const {results}=await directory.json() as any;assert.equal(results.length,1);assert.equal(results[0].source_url,huwei.sourceUrl);assert.match(results[0].menu_note,/3Q奶茶、3Q鮮奶茶：供應待確認/);
 const rec=await post('/api/recommend',{query:'3Q奶茶',filters:{brand:'CoCo都可'},store:results[0]});
 assert.equal(rec.response.status,200);assert.equal(rec.value.store.verified,1);
 assert.ok(rec.value.results.every((r:any)=>r.brand==='CoCo都可'));
 // Recommendations prioritize officially listed alternatives; unit tests cover every 3Q cup status.
 const exact=rec.value.results.find((r:any)=>r.name==='3Q奶茶');
 if(exact){assert.equal(exact.availability.status,'unknown');assert.match(exact.availability.evidence,/未列出不等於/);}
 const conflict=await post('/api/recommend',{query:'',filters:{brand:'50嵐'},store:results[0]});assert.equal(conflict.value.results.length,0);
});
