import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversationTurn} from '../worker/conversation';
import {numericConditions,parseNumber} from '../worker/numeric-language';
import {validateInput,understand} from '../worker/understand';
import {eligible,makeEngine} from '../worker/recommend';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
import catalog from '../data/catalog.json';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);
const turn=(message:string,state?:unknown)=>conversationTurn({message,state},brands);
const prior={query:'茶類',filters:{maxPrice:100,excludedToppings:['珍珠']},guard:''};

test('Chinese numbers, decimals, units and full-width bounds preserve the previous flavour',()=>{
  for(const [message,field,value] of [['預算八十','maxPrice',80],['五十塊錢以內','maxPrice',50],['咖啡因五十以下','maxCaffeine',50],['咖啡因０．０５ｇ','maxCaffeine',50],['熱量二百五十點五大卡','maxCalories',250.5]] as const){
    const result=turn(message,prior);assert.equal(result.state.filters[field],value);assert.equal(result.state.query,'茶類');assert.equal(result.followUp,undefined);
    assert.ok(engine.candidatePool(result.input).every(d=>eligible(d,result.state.filters)));
  }
  assert.equal(parseNumber('一千零五'),1005);assert.equal(parseNumber('負十'),-10);assert.ok(Number.isNaN(parseNumber('百百')));assert.ok(Number.isNaN(parseNumber('一百二')));assert.ok(Number.isNaN(parseNumber('二三十')));
  const raised=turn('預算提高到一百二十',turn('預算五十',prior).state);
  assert.equal(raised.state.filters.maxPrice,120);assert.equal(engine.recommend(raised.input).filters.maxPrice,120);
});

test('negative, impossible, unsupported and ambiguous values ask about their own field',()=>{
  for(const message of ['咖啡因少於零','咖啡因-10mg','咖啡因負十','咖啡因超過五十','咖啡因50到100','咖啡因50%','咖啡因50mg/ml','咖啡因50ml','咖啡因10001']){
    const result=turn(message,prior);assert.ok(result.followUp,message);assert.ok(result.followUp.message.includes('咖啡因'));assert.ok(!result.followUp.message.includes('濃郁奶茶'));
    assert.equal(result.state.filters.maxCaffeine,undefined);assert.equal(result.state.filters.maxPrice,100);assert.equal(result.state.query,'茶類');
  }
  const manual=understand(validateInput({query:'咖啡因少於零'}),brands);assert.equal(manual.blocked,true);
});

test('a short answer resolves the pending field and keeps budget and topping exclusions',()=>{
  const ask=turn('咖啡因少於零',prior);
  for(const [answer,value] of [['零',0],['五十以下',50],['改成５０就好',50]] as const){
    const next=turn(answer,ask.state);assert.equal(next.state.filters.maxCaffeine,value);assert.equal(next.state.pendingCaps,undefined);assert.equal(next.state.query,'茶類');assert.equal(next.state.filters.maxPrice,100);assert.deepEqual(next.state.filters.excludedToppings,['珍珠']);
  }
  const other=turn('80元以下',ask.state);assert.equal(other.state.filters.maxPrice,80);assert.equal(other.state.filters.maxCaffeine,undefined);assert.ok(other.followUp?.message.includes('咖啡因'));
  const cancelled=turn('不限',ask.state);assert.equal(cancelled.followUp,undefined);assert.equal(cancelled.state.filters.maxCaffeine,undefined);
  const nextBatch=turn('再推薦幾杯',ask.state);assert.ok(nextBatch.followUp);assert.equal(nextBatch.state.query,'茶類');
});

test('multiple unresolved caps remain pending until each is answered; reset removes them',()=>{
  const a=turn('咖啡因少於零，熱量-20',prior);assert.equal(a.state.pendingCaps?.length,2);
  const b=turn('零',a.state);assert.equal(b.state.filters.maxCaffeine,0);assert.equal(b.state.pendingCaps?.length,1);assert.ok(b.followUp?.message.includes('熱量'));
  const c=turn('二百以下',b.state);assert.equal(c.state.filters.maxCalories,200);assert.equal(c.followUp,undefined);
  assert.deepEqual(turn('重新開始',a.state).state,{query:'',filters:{},guard:''});
  for(const pendingCaps of [[{field:'password',reason:'missing'}],[{field:'maxPrice',reason:'custom'}],Array(4).fill({field:'maxPrice',reason:'missing'})])assert.throws(()=>turn('零',{...prior,pendingCaps}));
});

test('strict bounds exclude equality in both routes, while an explicit inclusive edit restores it',()=>{
  const d={...catalog.drinks.find(d=>d.caffeineMax!==null&&!d.caffeineEstimated)!,price:50,calories:50,caffeineMax:50,priceEstimated:false,caloriesEstimated:false,caffeineEstimated:false};
  for(const [phrase,key,exclusive] of [['預算少於五十','maxPrice','priceExclusive'],['熱量低於50','maxCalories','caloriesExclusive'],['咖啡因<50','maxCaffeine','caffeineExclusive']] as const){
    const strict=turn(phrase,prior);assert.equal(strict.state.filters[key],50);assert.equal(strict.state.filters[exclusive],true);assert.equal(eligible(d,strict.state.filters),false);
    const inclusive=turn(phrase.replace(/少於|低於|</,'不超過'),strict.state);assert.equal(inclusive.state.filters[exclusive],undefined);assert.equal(eligible(d,inclusive.state.filters),true);
    assert.equal(understand(validateInput({query:phrase,filters:{[key]:50}}),brands).filters[exclusive],true);
  }
  assert.throws(()=>validateInput({query:'',filters:{caffeineExclusive:true}}));
  assert.throws(()=>validateInput({query:'',filters:{maxCaffeine:50,caffeineExclusive:'yes'}}));
});

test('relative price requests ask for a number and cap removal preserves flavour',()=>{
  const a=turn('再便宜一點',prior);assert.ok(a.followUp?.message.includes('預算'));assert.equal(a.state.filters.maxPrice,100);
  const b=turn('五十',a.state);assert.equal(b.state.filters.maxPrice,50);assert.equal(b.state.query,'茶類');
  for(const message of ['咖啡因不限','取消咖啡因限制','沒有咖啡因限制','咖啡因不用限制']){const clear=turn(message,turn('咖啡因50',prior).state);assert.equal(clear.state.filters.maxCaffeine,undefined,message);assert.equal(clear.followUp,undefined);}
  assert.equal(turn('我不喜歡春水堂，太貴了',prior).followUp,undefined);
  const c=turn('預算不限',b.state);assert.equal(c.state.filters.maxPrice,undefined);assert.equal(c.state.filters.priceExclusive,undefined);assert.equal(c.state.query,'茶類');
});

test('Qwen cannot replace a verified numeric edit with another taste question or invented cap',()=>{
  const a=turn('咖啡因五十以下',prior);
  const out=applyLlmUnderstanding(a,{action:'clarify',query:'濃郁奶茶',filters:{maxCaffeine:999},assistantMessage:'你想喝奶茶嗎？',modelVersion:'qwen3.5-9b-4bit-test',durationMs:1},brands,[],[])!;
  assert.equal(out.clarify,false);assert.equal(out.state.query,'茶類');assert.equal(out.state.filters.maxCaffeine,50);assert.ok(out.ack.includes('咖啡因 ≤ 50'));
  const guarded=turn('咖啡因少於零',turn('花生過敏').state);assert.equal(guarded.followUp,undefined);assert.equal(engine.recommend(guarded.input).blocked,true);
});

test('coordinated topping exclusions apply to every named topping, retaining milk tea',()=>{
  for(const message of ['奶茶不要珍珠和布丁','奶茶我不喜歡珍珠、布丁和椰果']){
    const a=turn(message);assert.equal(a.state.guard,'');assert.ok(a.state.filters.excludedToppings?.includes('珍珠'));assert.ok(a.state.filters.excludedToppings?.includes('布丁'));assert.equal(a.state.filters.topping,undefined);
    assert.ok(engine.recommend(a.input).results.every(d=>d.variants.every(v=>!v.toppings.some(t=>a.state.filters.excludedToppings?.includes(t)))));
  }
});

test('HTTP fallback asks a relevant follow-up and resolves it without an online Qwen',{skip:!process.env.TEST_BASE_URL},async()=>{
  const post=async(message:string,state:unknown)=>{const r=await fetch(process.env.TEST_BASE_URL+'/api/chat/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,state})});assert.equal(r.status,200);return r.json() as Promise<any>;};
  const a=await post('咖啡因少於零',prior);assert.equal(a.needsClarification,true);assert.deepEqual(a.results,[]);assert.ok(a.assistantMessage.includes('咖啡因'));assert.equal(a.chatModel,null);assert.ok(a.choices.some((c:any)=>c.message==='咖啡因0mg'));
  const b=await post('零',a.state);assert.equal(b.needsClarification,false);assert.equal(b.state.query,'茶類');assert.equal(b.filters.maxCaffeine,0);assert.ok(b.results.length);assert.ok(b.results.every((d:any)=>d.variants.every((v:any)=>v.caffeineMax===0)));
  const c=await post('預算八十',b.state);assert.equal(c.filters.maxPrice,80);assert.equal(c.filters.maxCaffeine,0);assert.equal(c.state.query,'茶類');
});
