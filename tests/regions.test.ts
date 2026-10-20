import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {regionDirectory,readRegion,regionEligible,originalRegionEligible,assertStoreRegion,regionStores} from '../worker/regions';
import {makeEngine} from '../worker/recommend';
import {validateInput} from '../worker/understand';
import {nearbyChoices} from '../worker/alternatives';
const engine=makeEngine(catalog.drinks);
test('Huwei CoCo never borrows Taoyuan store prices, nutrients or cup variants',()=>{
 const huwei=readRegion({city:'雲林縣',district:'虎尾鎮'})!;
 const coco=catalog.drinks.filter(d=>d.brand==='CoCo都可'&&!d.sourceKind);
 assert.ok(coco.some(d=>d.region?.includes('桃園')));
 assert.ok(coco.every(d=>!regionEligible(d,huwei)));
 const input={...validateInput({query:'3Q奶茶',filters:{brand:'CoCo都可',toppings:['芋圓']}}),region:huwei};
 assert.equal(engine.candidatePool(input).length,0);
 const response=engine.recommendWithTrace(input,{modelVersion:'test',durationMs:0,scores:coco.map(d=>({id:d.id,score:999}))},undefined,true).response;
 assert.equal(response.results.length,0);
 assert.ok(engine.recommend(validateInput({query:'',filters:{brand:'CoCo都可'}})).results.length);
 const sample=coco[0];
 assert.equal(originalRegionEligible({...sample,region:'商品頁未列指定地區／門市'},huwei),false);
 assert.equal(originalRegionEligible({...sample,region:'中／南部一般門市'},huwei),true);
 assert.equal(originalRegionEligible({...sample,region:'桃園（大園中正東店）'},readRegion({city:'桃園市'})!),false);
});
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
 const input=validateInput({query:''}),local={city:'雲林縣',district:'虎尾鎮',brands:new Set(['50嵐'])};
 // Unpriced local items cannot inherit an unrelated numeric price sheet.
 assert.equal(engine.candidatePool({...validateInput({query:'',filters:{maxPrice:70}}),region:{city:'臺北市',district:'中正區',brands:new Set(['50嵐'])}}).length,0);
 const pool=engine.candidatePool({...input,region:local});assert.ok(pool.length);assert.ok(pool.every(d=>d.brand==='50嵐'));
 const foreign=catalog.drinks.find(d=>d.brand!=='50嵐')!;
 const response=engine.recommendWithTrace({...input,region:local},{scores:[{id:foreign.id,score:999},{id:pool[0].id,score:1}],modelVersion:'test',durationMs:0},undefined,true).response;
 assert.ok(response.results.length);assert.ok(response.results.every(r=>regionEligible(r.drink,local)&&r.variants.every(d=>regionEligible(d,local))));
 const general=engine.candidatePool(input);assert.ok(general.some(d=>d.brand!=='50嵐'));
 const empty=engine.recommend({...input,region:{...local,brands:new Set()}});assert.equal(empty.results.length,0);
 const alternatives=nearbyChoices(engine,catalog.drinks,{...input,region:{...local,brands:new Set()}},empty);assert.equal(alternatives.alternatives.length,0);
});
