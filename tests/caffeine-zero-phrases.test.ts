import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversationTurn} from '../worker/conversation';
import {makeEngine} from '../worker/recommend';
import {consumerContractMatches} from '../worker/consumer-contract';
import {validateInput} from '../worker/understand';
import catalog from '../data/catalog.json';
const brands=Object.keys(catalog.brands),engine=makeEngine(catalog.drinks);
const turn=(message:string,state?:unknown)=>conversationTurn({message,state},brands);
const prior={query:'茶類',filters:{maxPrice:100},guard:''};

test('every exact zero spelling from the screenshots is a hard caffeine filter',()=>{
  for(const message of ['咖啡因含量為零','咖啡因為零','咖啡因=0','咖啡因含量等於零','咖啡因＝０','100元內 茶類 咖啡因含量為零']){
    const a=turn(message,prior);assert.equal(a.state.filters.maxCaffeine,0,message);assert.equal(a.followUp,undefined,message);assert.equal(a.state.query,'茶類');
    const r=engine.recommend(a.input);assert.ok(r.results.length,message);assert.ok(r.results.every(d=>d.variants.every(v=>v.caffeineMax===0&&!v.caffeineEstimated)));assert.ok(!r.results.some(d=>d.brand==='可不可熟成茶行'&&d.name==='熟成紅茶'));
  }
});

test('near-zero needs an explicit threshold while preserving flavour and budget, then zero resolves it',()=>{
  for(const message of ['100元內 茶類 咖啡因含量近乎為零','100元內 茶類 咖啡因幾乎為零','100元內 茶類 接近零咖啡因']){
    const a=turn(message);assert.equal(a.state.query,'茶類');assert.equal(a.state.filters.maxPrice,100);assert.equal(a.state.filters.maxCaffeine,undefined);assert.deepEqual(a.state.pendingCaps,[{field:'maxCaffeine',reason:'approximate-zero'}]);assert.ok(a.followUp?.message.includes('近乎為零'));assert.ok(a.followUp?.choices.some(c=>c.message==='咖啡因=0'));
    const b=turn('咖啡因=0',a.state);assert.equal(b.state.query,'茶類');assert.equal(b.state.filters.maxCaffeine,0);assert.equal(b.followUp,undefined);
    const c=turn('五以下',a.state);assert.equal(c.state.filters.maxCaffeine,5);assert.equal(c.state.query,'茶類');
  }
  const decimal=turn('咖啡因近乎0.1mg',prior);assert.ok(decimal.followUp);assert.equal(decimal.state.filters.maxCaffeine,undefined);
});

test('a dirty legacy flavour is repaired and zero is retained through all screenshot turns',()=>{
  let state:any={query:'茶類 咖啡因含量為零',filters:{maxPrice:100,maxCaffeine:0},guard:''};
  for(const message of ['咖啡因含量為零','咖啡因為零','咖啡因=0']){const a=turn(message,state);state=a.state;assert.equal(state.query,'茶類');assert.equal(state.filters.maxCaffeine,0);assert.equal(a.followUp,undefined);assert.ok(engine.recommend(a.input).results.every(d=>d.variants.every(v=>v.caffeineMax===0)));}
});

test('the final contract rejects dropped zero and unsafe selectable cups',()=>{
  const zero=catalog.drinks.find(d=>d.caffeineMax===0&&!d.caffeineEstimated&&d.price!==null&&!d.priceEstimated&&d.price<=100)!;
  const red=catalog.drinks.find(d=>d.brand==='可不可熟成茶行'&&d.name==='熟成紅茶')!;
  const f=validateInput({query:'茶類',filters:{maxCaffeine:0,maxPrice:100}}).filters;
  assert.equal(consumerContractMatches(f,{...f},[{drink:zero,variants:[zero]}]),true);
  assert.equal(consumerContractMatches(f,{...f,maxCaffeine:undefined},[{drink:zero,variants:[zero]}]),false);
  assert.equal(consumerContractMatches(f,{...f},[{drink:red,variants:[red]}]),false);
  assert.equal(consumerContractMatches(f,{...f},[{drink:zero,variants:[zero,red]}]),false);
  assert.equal(consumerContractMatches(f,{...f},[{drink:zero,variants:[]}]),false);
});

test('HTTP screenshot sequence uses aligned filter snapshots and never returns the red tea',{skip:!process.env.TEST_BASE_URL},async()=>{
  let state:any;
  for(const [i,message] of ['100元內 茶類 咖啡因含量近乎為零','咖啡因含量為零','咖啡因為零','咖啡因=0'].entries()){
    const r=await fetch(process.env.TEST_BASE_URL+'/api/chat/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,state})});assert.equal(r.status,200);const v=await r.json() as any;state=v.state;
    assert.deepEqual(state.filters,v.filters);assert.equal(state.query,'茶類');assert.equal(state.filters.maxPrice,100);
    if(i===0){assert.equal(v.needsClarification,true);assert.deepEqual(v.results,[]);assert.equal(state.filters.maxCaffeine,undefined);}
    else {assert.equal(v.needsClarification,false);assert.equal(state.filters.maxCaffeine,0);assert.ok(v.results.length);assert.ok(v.results.every((d:any)=>d.variants.every((n:any)=>n.caffeineMax===0&&!n.caffeineEstimated)));assert.ok(!v.results.some((d:any)=>d.brand==='可不可熟成茶行'&&d.name==='熟成紅茶'));}
  }
});
