import assert from 'node:assert/strict';import {test} from 'node:test';
import catalog from '../data/catalog.json';import audit from '../data/research/branch-menu-audit.json';
import directory from '../data/nidin-directory.json';
import {makeEngine,eligible} from '../worker/recommend';import {readRegion,regionalDrink,regionEligible} from '../worker/regions';import {validateInput} from '../worker/understand';
test('only the 23 missing known branches were audited and brand references never become branch evidence',()=>{
 assert.equal(audit.entries.length,23);const brands=new Set(catalog.drinks.filter(d=>!d.sourceKind).map(d=>d.brand));assert.equal(brands.size,41);
 for(const entry of audit.entries){assert.ok(brands.has(entry.brand));if(entry.status==='pending'){assert.equal(entry.menuItems.length,0);assert.equal(entry.menuScope,'pending');}}
 for(const store of directory.stores.filter(s=>s.menuScope==='branch'))assert.ok(store.menuNames?.length);
});
test('Huwei 19TeaHouse now recommends only the verified local official menu with unknown facts protected',()=>{
 const region=readRegion({city:'雲林縣',district:'虎尾鎮'})!,engine=makeEngine(catalog.drinks);
 const input={...validateInput({query:'',filters:{brand:'拾汣茶屋'}}),region};
 const pool=engine.candidatePool(input);assert.ok(pool.length>20);
 assert.ok(pool.every(d=>d.sourceKind==='official-menu'&&regionEligible(d,region)));
 for(const d of pool){assert.match(regionalDrink(d,region).sourceUrl!,/dudooeat.*f35db32/);for(const f of [{maxPrice:1000},{maxCalories:1000},{maxCaffeine:1000},{excludedToppings:['珍珠']},{milkTea:false}])assert.equal(eligible(d,f),false);}
 const response=engine.recommend(input);assert.ok(response.results.length);assert.equal(new Set(response.results.map(d=>d.name)).size,response.results.length);
 const disliked=engine.recommend({...input,dislikedIds:[response.results[0].id]});assert.ok(disliked.results.every(r=>r.name!==response.results[0].name));
});
