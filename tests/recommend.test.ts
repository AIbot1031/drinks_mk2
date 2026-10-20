import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../data/catalog.json';
import { eligible, makeEngine } from '../worker/recommend';
import { validateInput, understand } from '../worker/understand';
import type { Drink } from '../worker/types';
import {favoriteProducts,groupProducts} from '../worker/products';

const drinks: Drink[] = catalog.drinks;
const engine = makeEngine(drinks);
const input = (query = '', filters = {}) => validateInput({query, filters});

test('a favorite from any cup size expands every catalogue variant without duplicate products',()=>{
  const groups=[...groupProducts(drinks).values()];
  for(const variants of groups.filter((_,i)=>i%100===0||i<100)){
    const saved=variants.at(-1)!;
    const result=favoriteProducts(drinks,[saved.id,saved.id,variants[0].id]);
    assert.equal(result.length,1);
    assert.deepEqual(result[0].variants.map(d=>d.id),variants.map(d=>d.id));
    assert.equal(result[0].id,variants[0].id);
  }
  assert.deepEqual(favoriteProducts(drinks,['removed-id']),[]);
  const sameName=drinks.find(d=>drinks.some(other=>other.name===d.name&&other.brand!==d.brand))!;
  assert.ok(favoriteProducts(drinks,[sameName.id])[0].variants.every(d=>d.brand===sameName.brand));
});

test('new workbook keeps all cup variants, stable unique IDs and source estimates', () => {
  const original=drinks.filter(d=>d.sourceKind!=='nidin');
  assert.equal(original.length, 5781);
  assert.equal(new Set(drinks.map(d => d.id)).size, catalog.total);
  assert.equal(new Set(original.map(d=>d.brand)).size,41);
  assert.equal(drinks.filter(d=>d.caloriesEstimated).length,2535);
  assert.equal(original.filter(d=>d.caffeineMax===null).length,3232);
  assert.ok(original.every(d=>d.sourceRow>=2&&!d.allergensVerified&&d.sourceSheet==='飲料品項'));
  const estimated=drinks.find(d=>d.caloriesEstimated&&d.caffeineEstimated&&d.priceEstimated)!;
  assert.equal(eligible(estimated,{maxPrice:10000}),false);
  assert.equal(eligible(estimated,{maxCalories:10000}),false);
  assert.equal(eligible(estimated,{maxCaffeine:10000}),false);
  assert.ok(drinks.some(d=>d.tea.includes('抹茶')));
});
test('updated Numbers pearl topping excludes the corrected product from no-pearl candidates',()=>{
  const corrected=drinks.filter(d=>d.brand==='一沐日'&&d.name==='逮丸奶茶');
  assert.ok(corrected.length);assert.ok(corrected.every(d=>d.toppings.includes('珍珠')&&d.taste.includes('草仔粿')));
  const pool=engine.candidatePool(input('奶茶',{brand:'一沐日',excludedToppings:['珍珠']}));
  assert.ok(pool.every(d=>d.name!=='逮丸奶茶'));
});
test('milk modes audit the full catalogue and product cards keep only eligible variants at minimum price',()=>{
  assert.equal(engine.recommend(input('植物奶',{milk:'fresh'})).blocked,true);
  assert.equal(engine.recommend(input('鮮奶',{milk:'plant'})).blocked,true);
  for(const milk of ['none','fresh','plant'] as const){
    const result=engine.recommend(input('',{milk}));
    const keys=result.results.map(r=>JSON.stringify([r.brand,r.name]));
    assert.equal(new Set(keys).size,keys.length);
    for(const row of result.results){
      assert.equal(row.drink.price,Math.min(...row.variants.map(d=>d.price??Infinity)));
      assert.ok(row.variants.every(d=>eligible(d,{milk})&&d.brand===row.brand&&d.name===row.name));
    }
    for(const d of drinks.filter(d=>eligible(d,{milk}))){
      if(milk==='none')assert.ok(d.noMilk&&!d.milk.length&&!d.milkConflict);
      else {assert.ok(d.milk.includes(milk==='fresh'?'鮮奶':'植物奶'));if(milk==='plant')assert.ok(!d.milk.includes('鮮奶')&&!d.milk.includes('奶精'));}
    }
  }
  const first=engine.recommend(input('清爽'));
  const next=engine.recommend({...input('清爽'),excludedIds:first.results.map(r=>r.id)});
  assert.ok(next.results.every(r=>!first.results.some(old=>r.brand===old.brand&&r.name===old.name)));
});
test('hard constraints are enforced in both retrieval paths and final results', () => {
  const filters = {maxPrice:60, maxCalories:200, maxCaffeine:100, milk:'none'};
  const result = engine.recommend(input('想喝清爽茶', filters));
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every(r => eligible(r.drink, result.filters)));
  assert.ok(result.results.every(r => r.drink.calories !== null && r.drink.caffeineMax !== null && r.drink.noMilk));
});
test('unknown nutrients never become zero or pass a numeric cap', () => {
  const unknown = {...drinks[0],calories:null,caffeineMax:null};
  assert.equal(eligible(unknown, {maxCalories:200}), false);
  assert.equal(eligible(unknown, {maxCaffeine:100}), false);
  const zero = engine.recommend(input('不要咖啡因'));
  assert.ok(zero.results.length > 0);
  assert.ok(zero.results.every(r => r.drink.caffeineMax === 0));
});
test('infeasible constraints return no results and are never relaxed', () => {
  const result = engine.recommend(input('清爽', {maxPrice:0}));
  assert.equal(result.results.length, 0);
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.filters.maxPrice, 0);
});
test('allergy requests fail closed even if the menu marks an allergen absent', () => {
  const result = engine.recommend(input('我對花生過敏，想喝奶茶'));
  assert.equal(result.blocked, true);
  assert.equal(result.results.length, 0);
  assert.ok(result.warnings.some(w => w.includes('過敏原')));
});
test('typed and textual constraints use the stricter cap and reject conflicting milk', () => {
  const result = understand(input('預算 50 元，咖啡因不超過 100 mg，熱量 200 kcal', {maxPrice:40, maxCaffeine:80}), []);
  assert.equal(result.filters.maxPrice, 40);
  assert.equal(result.filters.maxCaffeine, 80);
  assert.equal(result.filters.maxCalories, 200);
  assert.equal(understand(input('不要奶類', {milk:'fresh'}), []).blocked, true);
  assert.equal(understand(input('咖啡因上限100mg'), []).filters.maxPrice, undefined);
});
test('fresh milk and pearl requests become actual feature filters', () => {
  const result = engine.recommend(input('想喝有珍珠的鮮奶飲料'));
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every(r => r.drink.milk.includes('鮮奶') && r.drink.toppings.includes('珍珠')));
});
test('dislikes and next-batch exclusions remain excluded after graph fusion', () => {
  const first = engine.recommend(input('奶香濃郁'));
  const ids = first.results.map(r => r.id);
  const second = engine.recommend({...input('奶香濃郁'), excludedIds:ids});
  assert.ok(second.results.length > 0);
  assert.ok(second.results.every(r => !ids.includes(r.id)));
  const disliked = engine.recommend({...input('奶香濃郁'), likedIds:ids, dislikedIds:ids});
  assert.equal(disliked.mode.personalized, true);
  assert.equal(disliked.mode.livePreferences, true);
  assert.ok(disliked.results.every(r => !ids.includes(r.id)));
});
test('genuine likes activate a repeatable personalised feature graph', () => {
  const favorite = drinks.find(d => d.milk.includes('鮮奶') && d.tea.includes('紅茶'))!;
  const personalized = {...input(''), likedIds:[favorite.id]};
  const result = engine.recommend(personalized);
  assert.equal(result.mode.personalized, true);
  assert.ok(result.results.some(r => r.ranks.b !== null));
  assert.deepEqual(result, engine.recommend(personalized));
});
test('validation rejects malformed, excessively large and invalid inputs', () => {
  for (const v of [null, {query:42}, {query:'x'.repeat(301)}, {query:'',filters:{milk:'banana'}}, {query:'',filters:{maxPrice:-1}}, {query:'',limit:NaN}, {query:'',likedIds:new Array(201).fill('id')}]) assert.throws(() => validateInput(v));
});
test('internal trace reconciles A/B ranks, individual contributions and consumer order',()=>{
  const {response,trace}=engine.recommendWithTrace(input('清爽回甘，預算60元'));
  for(const row of trace.fusion.ranked){
    assert.equal(trace.routeA.ranked.find(r=>r.id===row.id)?.rank??null,row.rankA);
    assert.equal(trace.routeB.ranked.find(r=>r.id===row.id)?.rank??null,row.rankB);
    assert.ok(Math.abs(row.totalScore-row.contributionA-row.contributionB)<1e-12);
  }
  assert.deepEqual(trace.selection.finalOrder.map(r=>r.id),response.results.map(r=>r.id));
  assert.deepEqual(trace.consumerOutput,response);
  assert.equal(trace.rendering.explanationAgentUsed,false);
  assert.equal(trace.selection.relaxHardFilters,false);
});


test('excluded brands stay out of both paths, favourites, fusion and every batch',()=>{
  const excludedBrands=['得正','可不可熟成茶行'];
  const actualBrands=[...new Set(drinks.map(d=>d.brand))];
  const exclusions=excludedBrands.filter(b=>actualBrands.includes(b));
  assert.equal(exclusions.length,2);
  const excludedFavorite=drinks.find(d=>exclusions.includes(d.brand))!;
  const request={...input('清爽', {excludedBrands:exclusions}),likedIds:[excludedFavorite.id]};
  const {response,trace}=engine.recommendWithTrace(request);
  assert.ok(response.results.length>0);
  assert.ok(response.results.every(d=>!exclusions.includes(d.brand)));
  for(const list of [trace.routeA.ranked,trace.routeB.ranked,trace.fusion.ranked,trace.routeB.seeds])assert.ok(list.every(d=>!exclusions.includes(d.brand)));
  assert.equal(response.mode.personalized,false);
  assert.deepEqual(trace.understanding.filters.excludedBrands,exclusions);
  const next=engine.recommend({...request,excludedIds:response.results.map(d=>d.id)});
  assert.ok(next.results.length>0);assert.ok(next.results.every(d=>!exclusions.includes(d.brand)));
  const conflict=engine.recommend(input('',{brand:exclusions[0],excludedBrands:exclusions}));
  assert.equal(conflict.blocked,true);assert.equal(conflict.results.length,0);assert.ok(conflict.warnings.some(w=>w.includes('同時被指定與排除')));
  const all=engine.recommend({...input(''),filters:{excludedBrands:actualBrands}});assert.equal(all.results.length,0);assert.equal(all.eligibleCount,0);assert.equal(all.blocked,false);
  assert.equal(engine.recommend(input('',{excludedBrands:['不存在的品牌']})).blocked,true);
  for(const invalid of ['得正',[12],[''],new Array(51).fill('得正')])assert.throws(()=>validateInput({query:'',filters:{excludedBrands:invalid}}));
});
