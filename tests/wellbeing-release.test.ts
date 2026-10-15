import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {conversationTurn} from '../worker/conversation';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
import {wellbeingAdvice} from '../worker/wellbeing';
import {makeEngine} from '../worker/recommend';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);

test('other drink choices do not turn a first-person sleep request into a third-person statement',()=>{
  for(const message of ['睡前想喝其他飲料','準備睡覺，還有其他選擇嗎'])assert.equal(wellbeingAdvice(message).sleep,true,message);
  for(const message of ['其他人準備睡覺','朋友準備睡覺'])assert.equal(wellbeingAdvice(message).sleep,false,message);
});
test('releasing caffeine survives a model query that repeated a consumed sleep goal',()=>{
  const initial=conversationTurn({message:'準備睡覺，想喝清爽的，預算80元'},brands);
  const understood=applyLlmUnderstanding(initial,{action:'recommend',query:'睡前清爽的飲料',filters:{maxCaffeine:0,maxPrice:80},assistantMessage:'好',modelVersion:'qwen3.5-9b-4bit-test',durationMs:1},brands,[],[])!;
  const release=conversationTurn({message:'咖啡因不限',state:understood.state},brands);
  const result=engine.recommend(release.input);
  assert.equal(result.filters.maxCaffeine,undefined);
  assert.equal(result.filters.maxPrice,80);
});
test('an explicit release also clears a legacy sleep phrase from retrieval text',()=>{
  const release=conversationTurn({message:'咖啡因不限',state:{query:'睡前清爽的飲料',filters:{maxCaffeine:0,maxPrice:80},guard:''}},brands);
  assert.equal(engine.recommend(release.input).filters.maxCaffeine,undefined);
  assert.equal(release.state.filters.maxPrice,80);
});
