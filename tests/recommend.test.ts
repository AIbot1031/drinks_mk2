import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../data/catalog.json';
import { eligible, makeEngine } from '../worker/recommend';
import { validateInput, understand } from '../worker/understand';
import type { Drink } from '../worker/types';

const drinks: Drink[] = catalog.drinks;
const engine = makeEngine(drinks);
const input = (query = '', filters = {}) => validateInput({query, filters});

test('Excel import produces unique, traceable records with unknown nutrients preserved', () => {
  assert.equal(drinks.length, 1178);
  assert.equal(new Set(drinks.map(d => d.id)).size, 1178);
  assert.equal(drinks.filter(d => d.calories === null).length, 239);
  assert.equal(drinks.filter(d => !d.caffeineText).length, 367);
  assert.equal(drinks.filter(d => d.caffeineMax === null).length, 386);
  assert.ok(drinks.filter(d => d.caffeineText.startsWith('≥')).every(d => d.caffeineMin === 201 && d.caffeineMax === null));
  assert.ok(drinks.every(d => d.sourceRow >= 2 && !d.allergensVerified));
});
test('hard constraints are enforced in both retrieval paths and final results', () => {
  const filters = {maxPrice:60, maxCalories:200, maxCaffeine:100, milk:'none'};
  const result = engine.recommend(input('想喝清爽茶', filters));
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every(r => eligible(r.drink, result.filters)));
  assert.ok(result.results.every(r => r.drink.calories !== null && r.drink.caffeineMax !== null && r.drink.noMilk));
});
test('unknown nutrients never become zero or pass a numeric cap', () => {
  const unknown = drinks.find(d => d.calories === null && d.caffeineMax === null)!;
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
  assert.equal(disliked.mode.personalized, false);
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
