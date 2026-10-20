import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import catalog from '../data/catalog.json';
import directory from '../data/nidin-directory.json';
import summary from '../public/nidin-research.json';
import index from '../data/research/nidin/index.json';
import {storeIdentity} from '../worker/stores';
test('national research totals reconcile with each brand, paginated stores and pending menus',()=>{
 assert.equal(index.brands.length,summary.beverageBrandCount);
 assert.equal(summary.platformBrandCount,index.platformBrandCount);
 let stores=0,menus=0,errors=0;
 const seen=new Set<string>();
 for(const entry of index.brands){
  assert.match(entry.code,/^[A-Za-z0-9_-]+$/);
  const data=JSON.parse(readFileSync('data/research/nidin/'+entry.code+'.json','utf8'));
  assert.equal(data.code,entry.code);assert.equal(data.name,entry.name);
  assert.equal(data.stores.length,data.expectedStoreCount);assert.ok(data.stores.length||data.status==='pending');
  for(const store of data.stores){
   const identity=data.code+':'+store.id;assert.ok(!seen.has(identity));seen.add(identity);
   assert.equal(store.sourceUrl,'https://order.nidin.shop/menu/'+store.id);
   assert.ok(Number.isFinite(Date.parse(store.checkedAt)));
   assert.ok(['listed','pending'].includes(store.menu.status));
   if(store.menu.status==='listed'){menus++;assert.ok(store.menu.categories.length);assert.ok(Array.isArray(store.menu.products));}
  }
  stores+=data.stores.length;errors+=data.errors.length;
 }
 assert.equal(stores,summary.storeCount);assert.equal(menus,summary.menuCount);assert.equal(errors,summary.pendingCount);
 assert.equal(index.brands.length+index.unclassifiedBrands.length,index.platformBrandCount);
});
test('runtime directory uses only mapped catalog brands, exact product names and consistent store identities',async()=>{
 const names=new Map(Object.keys(catalog.brands).map(b=>[b,new Set(catalog.drinks.filter(d=>d.brand===b).map(d=>d.name))]));
 for(const s of directory.stores){
  assert.ok(names.has(s.brand));assert.ok(directory.regions.some(r=>r.city===s.city&&r.district===s.district));
  if('menuNames' in s)for(const name of s.menuNames??[])assert.ok(names.get(s.brand)!.has(name));
 }
 for(const s of directory.stores.filter((_,i)=>i%100===0))assert.equal((await storeIdentity(s,Object.keys(catalog.brands))).id,s.id);
 assert.equal(directory.stores.length,summary.recommendationStoreCount);
 assert.equal(directory.regions.length,summary.regionCount);
});
