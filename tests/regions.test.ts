import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {regionDirectory,readRegion,regionEligible,assertStoreRegion,regionStores} from '../worker/regions';
import {makeEngine} from '../worker/recommend';
import {validateInput} from '../worker/understand';
import {nearbyChoices} from '../worker/alternatives';
const engine=makeEngine(catalog.drinks);
test('region is validated against collected city/district pairs; missing and fabricated districts fail closed',()=>{
 assert.equal(readRegion(null),undefined);
 for(const value of [{},{city:'雲林縣',district:'不存在區'},[],{city:'',district:''}])assert.throws(()=>readRegion(value));
 const r=regionDirectory().regions.find(r=>r.city==='雲林縣'&&r.district==='虎尾鎮')!;
 assert.ok(r);const scope=readRegion(r)!;assert.ok(scope.brands.has('CoCo都可'));
 const stores=regionStores(r.city,r.district);assert.ok(stores.length>0);
 assert.doesNotThrow(()=>assertStoreRegion(stores[0],scope));
 assert.throws(()=>assertStoreRegion({...stores[0],address:'其他縣其他區其他路100號'},scope));
});
test('region filters candidates before all ranks and reranking, while general recommendations ignore it',()=>{
 const input=validateInput({query:'',filters:{maxPrice:70}}),local={city:'合成測試縣',district:'合成測試區',brands:new Set(['CoCo都可'])};
 const pool=engine.candidatePool({...input,region:local});assert.ok(pool.length);assert.ok(pool.every(d=>d.brand==='CoCo都可'));
 const foreign=catalog.drinks.find(d=>d.brand!=='CoCo都可')!;
 const response=engine.recommendWithTrace({...input,region:local},{scores:[{id:foreign.id,score:999},{id:pool[0].id,score:1}],modelVersion:'test',durationMs:0},undefined,true).response;
 assert.ok(response.results.length);assert.ok(response.results.every(r=>regionEligible(r.drink,local)&&r.variants.every(d=>regionEligible(d,local))));
 const general=engine.candidatePool(input);assert.ok(general.some(d=>d.brand!=='CoCo都可'));
 const empty=engine.recommend({...input,region:{...local,brands:new Set()}});assert.equal(empty.results.length,0);
 const alternatives=nearbyChoices(engine,catalog.drinks,{...input,region:{...local,brands:new Set()}},empty);assert.equal(alternatives.alternatives.length,0);
});
