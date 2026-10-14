import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversationTurn} from '../worker/conversation';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
const reply={query:'奶茶',filters:{milkTea:true},modelVersion:'qwen3-8b-4bit-test',durationMs:100,assistantMessage:'好，我幫你挑奶茶。'};
test('Qwen 3.5 9B is accepted with the same constraint contract; unsupported families are rejected',()=>{
 const turn=conversationTurn({message:'不喜歡奶茶，但想喝綠茶，預算80元'},[]);
 const newer={...reply,query:'綠茶',filters:{tea:'綠茶',milkTea:false,maxPrice:80},modelVersion:'qwen3.5-9b-4bit-8b2b98c00a6b-intent-v4'};
 const out=applyLlmUnderstanding(turn,newer,[],['綠茶'],[])!;
 assert.equal(out.state.filters.milkTea,false);assert.equal(out.state.filters.maxPrice,80);assert.equal(out.state.query,'綠茶');
 for(const modelVersion of ['qwen3.5-4b-4bit-test','other-model','qwen3.5-9b-unverified'])assert.equal(applyLlmUnderstanding(turn,{...newer,modelVersion},[],['綠茶'],[]),null);
});
test('LLM cannot invent exclusions or contradict verified constraints in acknowledgements',()=>{
 const turn=conversationTurn({message:'我想喝珍奶，預算100元'},['春水堂']);
 const output=applyLlmUnderstanding(turn,{...reply,filters:{milkTea:true,excludedToppings:['珍珠'],excludedBrands:['春水堂']},assistantMessage:'不加珍珠，排除春水堂'},['春水堂'],[],['珍珠'])!;
 assert.deepEqual(output.state.filters.excludedToppings,[]);assert.deepEqual(output.state.filters.excludedBrands,[]);
 assert.equal(output.state.filters.topping,'珍珠');assert.ok(!output.ack.includes('不加珍珠'));assert.ok(output.ack.includes('含珍珠'));
});
test('LLM cannot relax parsed budget, exclusions or clinical guards, or invent brands',()=>{
  const turn=conversationTurn({message:'奶茶不要珍珠，預算60元'},[]);
  const out=applyLlmUnderstanding(turn,{...reply,filters:{maxPrice:999,excludedToppings:[]}},[],[],['珍珠'])!;
  assert.equal(out.state.filters.maxPrice,60);assert.deepEqual(out.state.filters.excludedToppings,['珍珠']);
  const guarded=conversationTurn({message:'花生過敏'},[]);
  assert.equal(applyLlmUnderstanding(guarded,reply,[],[],[])!.input.query,guarded.state.guard);
  assert.equal(applyLlmUnderstanding(turn,{...reply,filters:{brand:'不存在'}},[],[],[]),null);
  assert.equal(applyLlmUnderstanding(turn,{...reply,filters:{sugar:'無糖'}},[],[],[]),null);
  assert.equal(applyLlmUnderstanding(turn,{...reply,durationMs:-1},[],[],[]),null);
  assert.notEqual(applyLlmUnderstanding(turn,{...reply,assistantMessage:'保證安全，價格50元'},[],[],[])!.ack,'保證安全，價格50元');
});

test('LLM asks a bounded follow-up and only raises a cap when the user states that value',()=>{
 const vague=conversationTurn({message:'想喝飲料'},[]);
 const ask=applyLlmUnderstanding(vague,{...reply,action:'clarify',assistantMessage:'想喝清爽茶類，還是濃郁奶茶？'},[],[],[])!;
 assert.equal(ask.clarify,true);assert.equal(ask.state.clarification,'taste');
 const prior=conversationTurn({message:'清爽，預算60元'},[]);
 const changed=conversationTurn({message:'預算提高到100元',state:prior.state},[]);
 assert.equal(applyLlmUnderstanding(changed,{...reply,filters:{maxPrice:100}},[],[],[])!.state.filters.maxPrice,100);
 const unknown=conversationTurn({message:'不要神秘配料'},[]);
 const clarified=conversationTurn({message:'珍珠',state:unknown.state},[]);
 assert.equal(clarified.state.guard,'');assert.deepEqual(clarified.state.filters.excludedToppings,['珍珠']);assert.equal(clarified.state.filters.topping,undefined);
});
