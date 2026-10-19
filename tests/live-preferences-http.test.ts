import assert from 'node:assert/strict';
import {test} from 'node:test';
const base=process.env.TEST_BASE_URL;
const post=async(path:string,body:unknown,cookie?:string)=>{
 const response=await fetch(base+path,{method:path==='/api/account/preferences'?'PUT':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 return {response,value:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]};
};
test('guest preference refresh supports all four actions and reset batching without invoking models',{skip:!base},async()=>{
 const initial=await post('/api/recommend',{query:'',filters:{brand:'50嵐',maxPrice:70}});assert.equal(initial.response.status,200);
 const ctx=initial.value.rankingContext,id=initial.value.results[0].id;
 for(const prefs of [{likedIds:[id],dislikedIds:[]},{likedIds:[],dislikedIds:[]},{likedIds:[],dislikedIds:[id]},{likedIds:[],dislikedIds:[]}]){
  const {response,value}=await post('/api/preference-refresh',{rankingContext:ctx,...prefs,excludedIds:initial.value.results.map((r:any)=>r.id)});
  assert.equal(response.status,200);assert.equal(value.rankingReused,true);assert.deepEqual(value.filters,initial.value.filters);
  assert.ok(value.results.every((r:any)=>r.brand==='50嵐'&&r.variants.every((v:any)=>v.price<=70&&!v.priceEstimated)));
  assert.equal(value.mode.livePreferences,prefs.likedIds.length+prefs.dislikedIds.length>0);
  if(prefs.dislikedIds.length)assert.ok(value.results.every((r:any)=>r.name!==initial.value.results[0].name));
  else assert.ok(value.results.some((r:any)=>r.id===id));
 }
 const bad=await post('/api/preference-refresh',{rankingContext:{...ctx,appVersion:'old'}});assert.equal(bad.response.status,400);
 const cross=await fetch(base+'/api/preference-refresh',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify({rankingContext:ctx})});assert.equal(cross.status,403);
});
test('authenticated refresh uses saved preferences despite stale browser IDs; cancellations restore eligibility',{skip:!base},async()=>{
 const account=await post('/api/account/register',{id:'testlive'+crypto.randomUUID().replaceAll('-',''),password:'LiveTest123'});assert.equal(account.response.status,201);
 const cookie=account.cookie!;
 const initial=await post('/api/recommend',{query:'',filters:{brand:'50嵐'}},cookie),ctx=initial.value.rankingContext,id=initial.value.results[0].id;
 await post('/api/account/preferences',{likedIds:[],dislikedIds:[id]},cookie);
 const disliked=await post('/api/preference-refresh',{rankingContext:ctx,likedIds:[id],dislikedIds:[]},cookie);
 assert.equal(disliked.response.status,200);assert.ok(disliked.value.results.every((r:any)=>r.name!==initial.value.results[0].name));
 await post('/api/account/preferences',{likedIds:[],dislikedIds:[]},cookie);
 const undone=await post('/api/preference-refresh',{rankingContext:ctx,dislikedIds:[id]},cookie);
 assert.equal(undone.response.status,200);assert.ok(undone.value.results.some((r:any)=>r.id===id));
 assert.equal(undone.value.mode.livePreferences,false);
 await post('/api/account/logout',{},cookie);
});
test('chat accepted filters can be refreshed without a new conversational turn',{skip:!base},async()=>{
 const chat=await post('/api/chat/recommend',{message:'50嵐，預算70元',state:{query:'',filters:{},guard:''}});
 assert.equal(chat.response.status,200);assert.ok(chat.value.rankingContext);
 const id=chat.value.results[0].id;
 const refreshed=await post('/api/preference-refresh',{rankingContext:chat.value.rankingContext,dislikedIds:[id]});
 assert.equal(refreshed.response.status,200);assert.deepEqual(refreshed.value.filters,chat.value.filters);assert.ok(refreshed.value.results.every((r:any)=>r.name!==chat.value.results[0].name));
});

test('preference refresh retains sleep constraints and research notices from accepted manual input',{skip:!base},async()=>{
 const initial=await post('/api/recommend',{query:'睡前清爽的，咖啡因100mg以下'});
 const refresh=await post('/api/preference-refresh',{rankingContext:initial.value.rankingContext,likedIds:initial.value.results.slice(0,1).map((r:any)=>r.id)});
 assert.equal(refresh.response.status,200);assert.equal(refresh.value.filters.maxCaffeine,0);
 assert.deepEqual(refresh.value.wellbeing,initial.value.wellbeing);
 assert.ok(refresh.value.results.every((r:any)=>r.variants.every((d:any)=>d.caffeineMax===0&&!d.caffeineEstimated)));
});
