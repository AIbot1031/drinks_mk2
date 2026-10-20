import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {eligible,makeEngine} from '../worker/recommend';
import {readRegion,regionEligible} from '../worker/regions';
import {validateInput} from '../worker/understand';
import {groupProducts} from '../worker/products';
import type {Drink} from '../worker/types';
const drinks:Drink[]=catalog.drinks;
const added=drinks.filter(d=>d.sourceKind==='nidin');
test('new catalog retains original IDs, contains new brands, and keeps unknown facts null',()=>{
 assert.equal(drinks.filter(d=>d.id.startsWith('d_')).length,5781);
 assert.equal(new Set(drinks.map(d=>d.id)).size,drinks.length);
 assert.ok(Object.keys(catalog.brands).length>41);assert.ok(added.length>20000);
 for(const d of added){
  assert.equal(d.price,null);assert.equal(d.calories,null);assert.equal(d.caffeineMax,null);
  assert.deepEqual(d.toppings,[]);assert.equal(d.noMilk,false);assert.ok(d.pendingFields?.length);
  for(const filters of [{maxPrice:1000},{maxCalories:1000},{maxCaffeine:1000},{milk:'none' as const},{excludedToppings:['珍珠']},{milkTea:false}])assert.equal(eligible(d,filters),false);
 }
});
test('new beverages are recommendable with county-only scope and cannot leak across their collected item regions',()=>{
 const drink=added.find(d=>d.regionKeys?.length===1)!;
 const [city,district]=drink.regionKeys![0].split('|');
 const county=readRegion({city})!,town=readRegion({city,district})!;
 assert.equal(county.district,'');assert.ok(regionEligible(drink,county));assert.ok(regionEligible(drink,town));
 assert.equal(regionEligible(drink,{city:'不存在縣',district:'',brands:new Set([drink.brand])}),false);
 assert.equal(regionEligible(drink,{city,district:'不存在區',brands:new Set([drink.brand])}),false);
 const engine=makeEngine(drinks),input={...validateInput({filters:{brand:drink.brand},query:drink.name}),region:county};
 const result=engine.recommend(input);assert.ok(result.results.length);
 assert.ok(result.results.every(r=>regionEligible(r.drink,county)));
 const hidden=engine.recommend({...input,dislikedIds:result.results.map(r=>r.id)});
 assert.ok(hidden.results.every(r=>!result.results.some(previous=>previous.name===r.name)));
});

test('duplicate menu names share one card while original variants and different store evidence remain',()=>{
 const groups=groupProducts(drinks);
 const mixed=[...groups.values()].filter(rows=>rows.some(d=>d.sourceKind==='nidin')&&rows.some(d=>d.sourceKind!=='nidin'));
 assert.ok(mixed.length>0);
 for(const rows of mixed){
  assert.ok(rows.some(d=>d.id.startsWith('d_')));
  for(const row of rows.filter(d=>d.sourceKind==='nidin'))assert.ok(row.sourceStoreIds?.length);
 }
 const engine=makeEngine(drinks),sample=mixed[0][0];
 const result=engine.recommend(validateInput({query:sample.name,filters:{brand:sample.brand}}));
 assert.equal(new Set(result.results.map(d=>JSON.stringify([d.brand,d.name]))).size,result.results.length);
});
