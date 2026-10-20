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
async function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync('migrations/0007_store_availability.sql','utf8'));
 const prepare=(query:string)=>{let values:SQLInputValue[]=[];const s={bind(...v:SQLInputValue[]){values=v;return s;},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return {meta:{changes:Number(result.changes)}};}};return s;};
 const db={prepare,async batch(statements:Array<{run:()=>Promise<unknown>}>){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
 for(const name of [branch.name,'合成測試門市B']){const s=await storeIdentity({...branch,name},brands);sql.prepare('INSERT INTO drink_stores(id,brand,name,address,verified,source_url,checked_at) VALUES(?,?,?,?,1,?,?)').run(s.id,s.brand,s.name,s.address,'https://example.com/fixture',Date.now());}
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
 const {db,sql}=await database(),d=drinks.find(d=>d.brand===branch.brand)!,reporterId=crypto.randomUUID(),id=crypto.randomUUID();
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
 const {db,sql}=await database(),d=drinks.find(d=>d.brand===branch.brand)!,reporterId=crypto.randomUUID();
 const first=await submitStoreReport(db,{store:branch,drinkId:d.id,kind:'sold_out',reporterId,id:crypto.randomUUID()},drinks);
 await reviewStoreReport(db,{reportId:first.id,status:'reject'});assert.equal((await loadStoreSupply(db,branch,[],drinks))!.excluded.size,0);
 for(let i=1;i<20;i++)await submitStoreReport(db,{store:branch,drinkId:d.id,kind:'sold_out',reporterId,id:crypto.randomUUID()},drinks);
 await assert.rejects(submitStoreReport(db,{store:branch,drinkId:d.id,kind:'sold_out',reporterId,id:crypto.randomUUID()},drinks));
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM store_reports').get()!.n,20);sql.close();
});
test('official Huwei snapshot separates verified address, listed products and unconfirmed 3Q, expires and never leaks to other branches',async()=>{
 const {default:huwei}=await import('../data/coco-huwei-store.json');
 const {db,sql}=await database(),checked=Date.parse(huwei.checkedAt),now=checked+1000;
 const stores=(await listedStores(db,brands,'虎尾')).filter(s=>s.brand==='CoCo都可');assert.equal(stores.length,1);
 const store=stores[0];assert.equal(store.name,'雲林虎尾店');assert.equal(store.address,'雲林縣虎尾鎮中正路125號');assert.equal(store.verified,1);assert.equal(store.source_url,huwei.sourceUrl);assert.equal(store.phone,huwei.phone);assert.match(store.menu_note!,/3Q奶茶、3Q鮮奶茶：供應待確認/);
 const supply=(await loadStoreSupply(db,store,[],drinks,now))!;
 const pearl=drinks.find(d=>d.brand===store.brand&&d.name==='珍珠奶茶')!;
 const threeQ=drinks.filter(d=>d.brand===store.brand&&d.name==='3Q奶茶');assert.ok(threeQ.length);
 assert.equal(supply.statuses.get(productKey(pearl))!.status,'available');
 for(const d of threeQ){const status=supply.statuses.get(productKey(d))!;assert.equal(status.status,'unknown');assert.match(status.evidence,/未列出不等於門市未販售/);assert.equal(status.sourceUrl,huwei.sourceUrl);assert.equal(supply.excluded.has(productKey(d)),false);}
 const expired=(await loadStoreSupply(db,store,[],drinks,checked+7*86400000))!;assert.equal(expired.statuses.get(productKey(pearl))!.status,'unknown');assert.match(expired.statuses.get(productKey(pearl))!.evidence,/重新確認/);
 await assert.rejects(loadStoreSupply(db,{...huwei,name:'其他門市'},[],drinks,now),/已收錄/);
 assert.equal((await loadStoreSupply(db,huwei,[],drinks,checked-1))!.statuses.get(productKey(pearl))!.status,'unknown');
 // A pending report does not alter the snapshot; an active reviewed status overrides it.
 sql.prepare('INSERT INTO drink_stores(id,brand,name,address,checked_at) VALUES(?,?,?,?,?)').run(store.id,store.brand,store.name,store.address,now);
 sql.prepare('INSERT INTO store_availability VALUES(?,?,?,?,?,?,?)').run(store.id,productKey(pearl),'sold_out',now,now+10000,'合成查證覆蓋測試','https://example.com');
 const overridden=(await loadStoreSupply(db,store,[],drinks,now))!;assert.equal(overridden.statuses.get(productKey(pearl))!.status,'sold_out');assert.ok(overridden.excluded.has(productKey(pearl)));
 sql.close();
});
test('all original workbook brands have a truthful Huwei research state, and only branch evidence grants listed status',async()=>{
 const {default:research}=await import('../data/huwei-brand-research.json');
 assert.deepEqual(research.brands.map(b=>b.brand).sort(),[...new Set(drinks.filter(d=>!d.sourceKind).map(d=>d.brand))].filter(b=>b!=='CoCo都可').sort());
 assert.equal(new Set(research.stores.map(s=>JSON.stringify([s.brand,s.name,s.address]))).size,research.stores.length);
 const {db,sql}=await database();
 const {default:directory}=await import('../data/nidin-directory.json');
 for(const original of research.stores){
  const seed={...original,...directory.stores.find(s=>s.brand===original.brand&&s.name===original.name&&s.address===original.address)};
  assert.ok(brands.includes(seed.brand));assert.match(seed.address,/雲林縣虎尾鎭|雲林縣虎尾鎮/);assert.ok(/^https?:\/\//.test(seed.sourceUrl));
  const at=Date.parse(seed.checkedAt),supply=(await loadStoreSupply(db,seed,[],drinks,at+1))!;
  assert.equal(supply.store.verified,1);assert.equal(supply.store.menu_source_url,seed.menuSourceUrl);
  for(const [key,status]of supply.statuses){
   const [brand,name]=JSON.parse(key);assert.equal(brand,seed.brand);
   if(seed.menuScope!=='branch'||!new Set<string>(seed.menuNames).has(name))assert.equal(status.status,'unknown');
   else if(new Set<string>(seed.soldOutNames).has(name))assert.equal(status.status,at+1<taipeiDayEnd(Date.parse(original.checkedAt))?'sold_out':'unknown');
   else assert.equal(status.status,'available');
  }
  const expired=(await loadStoreSupply(db,seed,[],drinks,at+7*86400000))!;assert.ok([...expired.statuses.values()].every(s=>s.status==='unknown'));
 }
 assert.ok(!research.stores.some(s=>s.brand==='一沐日'&&s.name.includes('光復')));sql.close();
});
test('official sold-out snapshot stops excluding at Taipei midnight but stays unconfirmed until rechecked',async()=>{
 const {default:research}=await import('../data/huwei-brand-research.json');const seed=research.stores.find(s=>s.soldOutNames.length)!;
 const {db,sql}=await database(),at=Date.parse(seed.checkedAt),name=seed.soldOutNames[0],key=JSON.stringify([seed.brand,name]);
 const before=(await loadStoreSupply(db,seed,[],drinks,at+1))!;assert.equal(before.statuses.get(key)!.status,'sold_out');assert.ok(before.excluded.has(key));
 const after=(await loadStoreSupply(db,seed,[],drinks,taipeiDayEnd(at)))!;assert.equal(after.statuses.get(key)!.status,'unknown');assert.equal(after.excluded.has(key),false);sql.close();
});
test('removed manual store flow rejects unknown or forged stores without persisting a report',async()=>{
 const {db,sql}=await database(),unknown={brand:branch.brand,name:'未收錄門市',address:branch.address,verified:1},d=drinks.find(d=>d.brand===branch.brand)!;
 await assert.rejects(loadStoreSupply(db,unknown,[],drinks),/已收錄/);
 await assert.rejects(submitStoreReport(db,{id:crypto.randomUUID(),reporterId:crypto.randomUUID(),store:unknown,drinkId:d.id,kind:'sold_out'},drinks),/已收錄/);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM store_reports').get()!.n,0);sql.close();
});
