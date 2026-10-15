import assert from 'node:assert/strict';
import {test} from 'node:test';
import {wellbeingAdvice} from '../worker/wellbeing';
import {conversationTurn} from '../worker/conversation';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
import {validateInput,understand} from '../worker/understand';
import {makeEngine} from '../worker/recommend';
import catalog from '../data/catalog.json';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);
test('sleep wins over focus, with zero verified caffeine in every selectable cup',()=>{
  for(const message of ['很累想提神，但準備睡覺','睡前想喝清爽的，咖啡因100mg以下','不想失眠，預算60元','等一下要睡覺']){
    const turn=conversationTurn({message},brands);
    assert.equal(turn.state.filters.maxCaffeine,0,message);
    const r=engine.recommend(turn.input);
    assert.ok(r.results.length>0,message);
    assert.ok(r.results.every(r=>r.variants.every(d=>d.caffeineMax===0&&!d.caffeineEstimated)));
    assert.equal(wellbeingAdvice(message).applied.includes('focus'),false);
  }
});
test('no sleep threshold invented from evening, fatigue, negation, quotes or others',()=>{
  for(const q of ['晚上要加班','我很累','不想睡覺，要提神','不是睡前喝','我沒有準備睡覺','朋友準備睡覺','「睡前」是什麼意思','如果準備睡覺應該喝什麼']){
    assert.equal(wellbeingAdvice(q).sleep,false,q);
    assert.equal(understand(validateInput({query:q}),brands).filters.maxCaffeine,undefined,q);
  }
});
test('advice never invents sugar, tea, caffeine or medical benefit filters',()=>{
  for(const q of ['難過想喝清爽的','今天沒喝水，口渴','想提神但咖啡因0mg']){
    const r=understand(validateInput({query:q}),brands);
    assert.equal(r.filters.tea,undefined);assert.equal(r.filters.maxCalories,undefined);
    if(q.includes('0mg'))assert.equal(r.filters.maxCaffeine,0);
    assert.ok(r.warnings.length);
  }
  assert.equal(wellbeingAdvice('口渴').sources[0].url,'https://pmc.ncbi.nlm.nih.gov/articles/PMC3984246/');
});
test('sleep constraints survive Qwen, followup and next batch, but explicit release works',()=>{
  const first=conversationTurn({message:'準備睡覺，想喝清爽的，60元內'},brands);
  const merged=applyLlmUnderstanding(first,{action:'recommend',query:'清爽',filters:{maxCaffeine:100},assistantMessage:'幫你找飲料',modelVersion:'qwen3.5-9b-4bit-test',durationMs:1},brands,[],[])!;
  assert.equal(merged.state.filters.maxCaffeine,0);assert.equal(merged.state.filters.maxPrice,60);
  for(const message of ['再推薦幾杯','預算改80元']){
    const next=conversationTurn({message,state:merged.state},brands);assert.equal(next.state.filters.maxCaffeine,0);
  }
  const release=conversationTurn({message:'咖啡因不限',state:first.state},brands);
  assert.equal(release.state.filters.maxCaffeine,undefined);
  assert.equal(engine.recommend(release.input).filters.maxCaffeine,undefined);
  const reset=conversationTurn({message:'重新開始',state:first.state},brands);assert.equal(reset.state.filters.maxCaffeine,undefined);
});
test('unavailable combinations stay empty and unknown or estimated zero never passes',()=>{
  const r=engine.recommend(validateInput({query:'睡前',filters:{maxPrice:0}}));assert.equal(r.results.length,0);
  for(const caffeineMax of [null,0]){
    const mini=makeEngine([{...catalog.drinks[0],caffeineMax,caffeineEstimated:true}]);
    assert.equal(mini.recommend(validateInput({query:'睡前'})).results.length,0);
  }
});
test('clarification acknowledgements cannot carry therapeutic claims',()=>{
  const turn=conversationTurn({message:'我想喝飲料'},brands);
  const merged=applyLlmUnderstanding(turn,{action:'clarify',query:'',filters:{},assistantMessage:'紅茶可以治療焦慮，要喝嗎？',modelVersion:'qwen3.5-9b-4bit-test',durationMs:1},brands,[],[])!;
  assert.ok(!merged.ack.includes('治療'));
});
test('model numeric merge cannot override the current sleep goal',()=>{
  const turn=conversationTurn({message:'睡前清爽的，咖啡因100mg以下'},brands);
  const result=applyLlmUnderstanding(turn,{action:'recommend',query:'清爽',filters:{maxCaffeine:100},assistantMessage:'好',modelVersion:'qwen3.5-9b-4bit-test',durationMs:1},brands,[],[])!;
  assert.equal(result.input.filters.maxCaffeine,0);
});
test('HTTP direct and chat sleep goals agree with candidate filtering',{skip:!process.env.TEST_BASE_URL},async()=>{
  for(const route of ['recommend','chat/recommend']){
    const payload=route==='recommend'?{query:'睡前清爽的，咖啡因100mg以下'}:{message:'睡前清爽的，咖啡因100mg以下'};
    const response=await fetch(`${process.env.TEST_BASE_URL}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(response.status,200);const r=await response.json() as any;
    assert.equal(r.filters.maxCaffeine,0);assert.ok(r.results.length);
    assert.ok(r.results.every((row:any)=>row.variants.every((d:any)=>d.caffeineMax===0&&!d.caffeineEstimated)));
    assert.ok(r.wellbeing.sources.some((s:any)=>s.url.includes('PMC3805807')));
  }
});
