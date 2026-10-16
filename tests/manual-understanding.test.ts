import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareManualUnderstanding,applyManualUnderstanding} from '../worker/manual-understanding';
import {validateInput} from '../worker/understand';
import {makeEngine,eligible} from '../worker/recommend';
import catalog from '../data/catalog.json';
const brands=Object.keys(catalog.brands),tea=[...new Set(catalog.drinks.flatMap(d=>d.tea))],toppings=[...new Set(catalog.drinks.flatMap(d=>d.toppings))];
const engine=makeEngine(catalog.drinks);
const prepare=(query:string,filters={})=>prepareManualUnderstanding(validateInput({query,filters}),brands);
const apply=(p:ReturnType<typeof prepare>,query:string,filters={},extra={})=>applyManualUnderstanding(p,{action:'recommend',query,filters,modelVersion:'qwen3.5-9b-4bit-test',durationMs:1,...extra},brands,tea,toppings);

test('manual Qwen can rewrite flavour while retaining form bounds and exclusions',()=>{
 const p=prepare('想喝比較不膩的飲料',{maxPrice:80,maxCalories:200,milk:'none',excludedBrands:['春水堂'],excludedToppings:['珍珠']});
 const a=apply(p,'清爽回甘',{maxPrice:999,maxCalories:999,milk:'any'})!;
 assert.ok(a);assert.equal(a.input.query,'清爽回甘');assert.equal(a.input.filters.maxPrice,80);assert.equal(a.input.filters.maxCalories,200);assert.equal(a.input.filters.milk,'none');assert.deepEqual(a.input.filters.excludedBrands,['春水堂']);assert.deepEqual(a.input.filters.excludedToppings,['珍珠']);
 const r=engine.recommend(a.input);assert.ok(r.results.length);assert.ok(r.results.every(d=>d.variants.every(v=>eligible(v,a.input.filters))));
});
test('manual mixed exact conditions stay outside flavour and Qwen cannot invent caps',()=>{
 const p=prepare('100元內 茶類 咖啡因=0',{maxPrice:80});
 const a=apply(p,'茶類 咖啡因999mg以下',{maxPrice:999,maxCaffeine:999})!;
 assert.equal(a.input.filters.maxPrice,80);assert.equal(a.input.filters.maxCaffeine,0);assert.ok(!/咖啡因|999/.test(a.input.query));
 const r=engine.recommend(a.input);assert.ok(r.results.every(d=>d.variants.every(v=>v.caffeineMax===0&&v.price!==null&&v.price<=80)));
});
test('manual ambiguous numeric request must still ask even when Qwen guesses a threshold',()=>{
 for(const query of ['比較沒負擔的，熱量低一點','100元內 茶類 咖啡因含量近乎為零','咖啡因少於零']){
  const p=prepare(query),a=apply(p,'清爽茶',{maxCalories:200,maxCaffeine:0})!;
  assert.ok(p.turn.followUp,query);assert.equal(a.input.filters.maxCalories,undefined);assert.equal(a.input.filters.maxCaffeine,undefined);
 }
});
test('manual unsupported restrictions cannot disappear behind model rewrite',()=>{
 for(const query of ['清爽茶，花生過敏','不要香菜的飲料']){
  const p=prepare(query),a=apply(p,'清爽茶')!;
  assert.equal(engine.recommend(a.input).blocked,true,query);
 }
});
test('manual command words cannot clear form settings; invalid model output falls back',()=>{
 const p=prepare('重新開始',{maxPrice:50,excludedBrands:['春水堂']});
 assert.equal(p.turn.reset,false);assert.equal(p.turn.input.filters.maxPrice,50);assert.deepEqual(p.turn.input.filters.excludedBrands,['春水堂']);
 assert.equal(apply(p,'清爽',{}, {modelVersion:'unknown'}),null);
 assert.equal(applyManualUnderstanding(p,null,brands,tea,toppings),null);
});
