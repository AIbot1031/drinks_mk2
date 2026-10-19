import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import catalog from '../data/catalog.json';
import {storeIdentity,listedStores,loadStoreSupply,submitStoreReport,reviewStoreReport,taipeiDayEnd,localExclusions,type StoreSupply} from '../worker/stores';
import {makeEngine,eligible} from '../worker/recommend';
import {validateInput} from '../worker/understand';
import {productKey,groupProducts} from '../worker/products';
const drinks=catalog.drinks,brands=Object.keys(catalog.brands);
const branch={brand:'CoCo都可',name:'合成測試門市A',address:'測試縣測試市測試路100號'};
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync('migrations/0007_store_availability.sql','utf8'));
 const prepare=(query:string)=>{let values:SQLInputValue[]=[];const s={bind(...v:SQLInputValue[]){values=v;return s;},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return {meta:{changes:Number(result.changes)}};}};return s;};
 const db={prepare,async batch(statements:Array<{run:()=>Promise<unknown>}>){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
 return {db,sql};
}
test('store identity separates exact branches, normalizes spacing and cannot accept forged metadata',async()=>{
 const a=await storeIdentity(branch,brands),same=await storeIdentity({...branch,address:'測試縣 測試市 測試路100號',verified:1,id:'forged'},brands),b=await storeIdentity({...branch,address:'測試縣測試市測試路101號'},brands);
 assert.equal(a.id,same.id);assert.notEqual(a.id,b.id);assert.equal(same.verified,0);
 for(const v of [{...branch,brand:'made-up'},{...branch,address:'短'},{...branch,name:'a\nb'},null])await assert.rejects(storeIdentity(v,brands));
});
test('local reports expire at Taipei midnight or seven days and never cross brands',async()=>{
 const store=await storeIdentity(branch,brands),d=drinks.find(d=>d.brand===branch.brand)!,foreign=drinks.find(d=>d.brand!==branch.brand)!;
 const at=Date.parse('2026-10-20T23:59:00+08:00'),record={storeId:store.id,drinkId:d.id,kind:'sold_out',reportedAt:at};
 assert.equal(taipeiDayEnd(at),Date.parse('2026-10-21T00:00:00+08:00'));
 assert.equal(localExclusions([record],store,drinks,at).size,1);assert.equal(localExclusions([record],store,drinks,taipeiDayEnd(at)).size,0);
 assert.equal(localExclusions([{...record,storeId:'another-store'}],store,drinks,at).size,0);
 assert.equal(localExclusions([{...record,drinkId:foreign.id}],store,drinks,at).size,0);
 assert.equal(localExclusions([{...record,kind:'not_sold'}],store,drinks,at+7*86400000).size,0);
 assert.throws(()=>localExclusions([{...record,reportedAt:Infinity}],store,drinks,at));
});
test('pending reports stay private to a session; only reviewed evidence affects other consumers and only one branch',async()=>{
 const {db,sql}=database(),d=drinks.find(d=>d.brand===branch.brand)!,reporterId=crypto.randomUUID(),id=crypto.randomUUID();
 const body={id,reporterId,store:branch,drinkId:d.id,kind:'not_sold'};
 const report=await submitStoreReport(db,body,drinks);await submitStoreReport(db,body,drinks);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM store_reports').get()!.n,1);
 const pending=await loadStoreSupply(db,branch,[],drinks);assert.equal(pending!.excluded.size,0);
 const self=await loadStoreSupply(db,branch,[report],drinks);assert.ok(self!.excluded.has(productKey(d)));
 await assert.rejects(reviewStoreReport(db,{reportId:id,status:'not_sold',evidence:'核對門市菜單',verifyStore:true}));
 await reviewStoreReport(db,{reportId:id,status:'not_sold',evidence:'合成測試菜單查核',sourceUrl:'https://example.com/menu',verifyStore:true});
 const confirmed=await loadStoreSupply(db,branch,[],drinks);assert.ok(confirmed!.excluded.has(productKey(d)));
 const other=await loadStoreSupply(db,{...branch,name:'合成測試門市B'},[],drinks);assert.equal(other!.excluded.size,0);
 assert.equal((await loadStoreSupply(db,branch,[],drinks,Date.now()+31*86400000))!.excluded.size,0);
 assert.ok((await listedStores(db,brands,'合成測試')).some(s=>s.name===branch.name));sql.close();
});
test('confirmed available products are preferred over unknown without crossing hard filters or reported cup variants',async()=>{
 const store=await storeIdentity(branch,brands),engine=makeEngine(drinks),pool=engine.candidatePool(validateInput({query:'',filters:{brand:branch.brand,maxPrice:70}}));
 const groups=[...groupProducts(pool).values()],target=groups.at(-1)![0],excluded=groups[0];
 const supply:StoreSupply={store,statuses:new Map([[productKey(target),{status:'available',checkedAt:1,expiresAt:Date.now()+10000,sourceUrl:'',evidence:'fixture'}]]),excluded:new Set([productKey(excluded[0])])};
 const input={...validateInput({query:'',filters:{maxPrice:70},likedIds:excluded.map(d=>d.id)}),supply};
 assert.ok(engine.candidatePool(input).every(d=>d.brand===store.brand&&productKey(d)!==productKey(excluded[0])));
 const result=engine.recommendWithTrace(input).response;assert.equal(result.results[0].name,target.name);
 assert.ok(result.results.every(r=>r.brand===store.brand&&r.variants.every(d=>eligible(d,result.filters)&&productKey(d)!==productKey(excluded[0]))));
 assert.equal(engine.recommendWithTrace({...input,filters:{brand:'50嵐'}}).response.results.length,0);
});
test('anonymous quotas bound writes and rejecting a report never changes public supply',async()=>{
 const {db,sql}=database(),d=drinks.find(d=>d.brand===branch.brand)!,reporterId=crypto.randomUUID();
 const first=await submitStoreReport(db,{store:branch,drinkId:d.id,kind:'sold_out',reporterId,id:crypto.randomUUID()},drinks);
 await reviewStoreReport(db,{reportId:first.id,status:'reject'});assert.equal((await loadStoreSupply(db,branch,[],drinks))!.excluded.size,0);
 for(let i=1;i<20;i++)await submitStoreReport(db,{store:branch,drinkId:d.id,kind:'sold_out',reporterId,id:crypto.randomUUID()},drinks);
 await assert.rejects(submitStoreReport(db,{store:branch,drinkId:d.id,kind:'sold_out',reporterId,id:crypto.randomUUID()},drinks));
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM store_reports').get()!.n,20);sql.close();
});
