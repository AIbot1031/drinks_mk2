import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conditionLabels} from '../public/chat-conditions.js';

test('turn labels distinguish no caffeine cap, zero and pending confirmation',()=>{
  const old={query:'茶類',filters:{maxPrice:100}};
  const oldLabels=conditionLabels(old);
  assert.ok(oldLabels.includes('咖啡因上限：未設定'));
  const zeroLabels=conditionLabels({query:'茶類',filters:{maxPrice:100,maxCaffeine:0}});
  assert.ok(zeroLabels.includes('咖啡因 ≤ 0 mg'));assert.ok(!zeroLabels.includes('咖啡因上限：未設定'));assert.ok(oldLabels.includes('咖啡因上限：未設定'));
  const pending=conditionLabels({query:'茶類',filters:{maxCaffeine:0},pendingCaps:[{field:'maxCaffeine',reason:'approximate-zero'}]});
  assert.ok(pending.includes('待確認：咖啡因'));assert.ok(!pending.includes('咖啡因 ≤ 0 mg'));
});

test('labels preserve strict comparisons, exclusions and their original immutable snapshot',()=>{
  const state={query:'清爽',filters:{maxPrice:80,maxCaffeine:50,caffeineExclusive:true,excludedToppings:['珍珠']}};
  const copy=structuredClone(state),labels=conditionLabels(state);assert.deepEqual(state,copy);assert.ok(labels.includes('咖啡因 < 50 mg'));assert.ok(labels.includes('不加：珍珠'));
  conditionLabels({query:'果香',filters:{maxCaffeine:0}});assert.ok(labels.includes('口味：清爽'));assert.ok(labels.includes('咖啡因 < 50 mg'));
});
