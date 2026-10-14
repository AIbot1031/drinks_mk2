import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {createProductPreferences,groupProducts,productKey} from '../worker/products';
import {makeEngine} from '../worker/recommend';
import {validateInput} from '../worker/understand';
const drinks=catalog.drinks,preferences=createProductPreferences(drinks),engine=makeEngine(drinks);
const groups=[...groupProducts(drinks).values()];
test('all cup/region variants normalize to one preference; conflicting legacy dislikes win',()=>{
 for(const variants of groups){
  const ids=variants.map(d=>d.id),canonical=variants[0].id;
  assert.deepEqual(preferences.normalize({likedIds:ids,dislikedIds:[]}),{likedIds:[canonical],dislikedIds:[]});
  assert.deepEqual(preferences.normalize({likedIds:ids,dislikedIds:[ids.at(-1)!]}),{likedIds:[],dislikedIds:[canonical]});
 }
 const a=drinks.find(d=>drinks.some(o=>o.name===d.name&&o.brand!==d.brand))!;
 const b=drinks.find(d=>d.name===a.name&&d.brand!==a.brand)!;
 const normalized=preferences.normalize({likedIds:[b.id],dislikedIds:[a.id]});
 assert.equal(normalized.likedIds.length,1);assert.equal(normalized.dislikedIds.length,1);
});
test('a disliked variant excludes the whole product before either model and from all fused variants',()=>{
 const variants=groups.find(g=>g.length>=4)!,target=variants.at(-1)!,key=productKey(target);
 const input=validateInput({query:target.name,likedIds:[variants[0].id],dislikedIds:[target.id]});
 assert.ok(engine.candidatePool(input).every(d=>productKey(d)!==key));
 const scores=variants.map((d,i)=>({id:d.id,score:100-i}));
 const {response,trace}=engine.recommendWithTrace(input,{scores,modelVersion:'synthetic',durationMs:1},{scores,modelVersion:'synthetic-relgt',durationMs:1});
 for(const list of [trace.routeA.ranked,trace.routeB.ranked,trace.fusion.ranked])assert.ok(list.every(d=>JSON.stringify([d.brand,d.name])!==key));
 assert.ok(response.results.every(p=>p.variants.every(d=>productKey(d)!==key)));
 assert.deepEqual(trace.input.likedIds,[]);
});
test('likes from different cups use one identical graph seed and recommendation',()=>{
 const variants=groups.find(g=>g.length>=3)!;
 const small=engine.recommendWithTrace(validateInput({query:'',likedIds:[variants[0].id]}));
 const large=engine.recommendWithTrace(validateInput({query:'',likedIds:variants.map(d=>d.id)}));
 assert.equal(large.trace.routeB.seeds.length,1);
 assert.deepEqual(small.response,large.response);
});
test('guest legacy preferences and account preferences survive fresh requests across sizes',{skip:!process.env.TEST_BASE_URL},async()=>{
 const base=process.env.TEST_BASE_URL!,variants=groups.find(g=>g.length>=3)!,small=variants[0],large=variants.at(-1)!;
 const post=async(path:string,body:unknown,cookie?:string)=>{
  const r=await fetch(base+path,{method:path.includes('/account/preferences')?'PUT':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  assert.equal(r.status,path.endsWith('/register')?201:200);return {body:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 };
 const legacy={likedIds:[small.id],dislikedIds:[large.id]};
 const normalized=(await post('/api/catalog/preferences',legacy)).body;
 assert.deepEqual(Object.keys(normalized.liked),[]);assert.deepEqual(normalized.disliked,[small.id]);assert.equal(normalized.dislikedProducts[small.id].name,small.name);
 const query={query:small.name,filters:{brand:small.brand}};
 const result=(await post('/api/recommend',{...query,...legacy})).body;
 assert.ok(result.results.every((p:any)=>p.name!==small.name));
 const register=await post('/api/account/register',{id:'testauth'+crypto.randomUUID().replaceAll('-',''),password:'Product123'}),cookie=register.cookie!;
 await post('/api/account/preferences',{likedIds:[],dislikedIds:[large.id]},cookie);
 const restored=await fetch(base+'/api/account/preferences',{headers:{Cookie:cookie}}).then(r=>r.json()) as any;
 assert.deepEqual(restored.disliked,[small.id]);
 const authenticated=(await post('/api/recommend',{...query,likedIds:[],dislikedIds:[]},cookie)).body;
 assert.ok(authenticated.results.every((p:any)=>p.name!==small.name));
 const liked=(await post('/api/account/preferences',{likedIds:[large.id,small.id],dislikedIds:[]},cookie)).body;
 assert.equal(Object.keys(liked.liked).length,1);assert.deepEqual(liked.disliked,[]);
 await post('/api/account/logout',{},cookie);
});
