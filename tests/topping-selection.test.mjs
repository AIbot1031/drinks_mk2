import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectedToppings} from '../public/topping-selection.js';
import {conditionLabels} from '../public/chat-conditions.js';
test('mixed atmosphere selections keep every topping, deduplicate aliases and respect exclusions',()=>{
  const filters={topping:'珍珠',toppings:['波霸','椰果','布丁'],excludedToppings:['椰果']},copy=structuredClone(filters);
  assert.deepEqual(selectedToppings(filters),['珍珠','布丁']);assert.deepEqual(filters,copy);
  assert.deepEqual(selectedToppings({}),[]);
  assert.deepEqual(selectedToppings({toppings:['珍珠','布丁'],excludedToppings:['波霸']}),['布丁']);
});
test('conversation condition chips show all required toppings',()=>{
  assert.ok(conditionLabels({filters:{toppings:['珍珠','布丁']}}).includes('含：珍珠、布丁'));
  assert.ok(conditionLabels({filters:{topping:'珍珠'}}).includes('珍珠'));
});
