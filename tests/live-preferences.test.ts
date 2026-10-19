import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../data/catalog.json';
import {makeEngine,eligible} from '../worker/recommend';
import {validateInput} from '../worker/understand';
import {livePreferenceScorer,LIVE_PREFERENCE_CONFIG} from '../worker/live-preferences';
import {readRankingContext} from '../worker/ranking-context';
import {appVersion} from '../worker/app-version';
import {catalogVersion} from '../worker/catalog-version';
import type {Drink} from '../worker/types';
const base=catalog.drinks[0];
const drink=(id:string,tea:string,milk:string[]=[],toppings:string[]=[]):Drink=>({...base,id,brand:id,name:id,tea:[tea],milk,toppings,taste:'清爽',price:40,priceEstimated:false,calories:100,caloriesEstimated:false,caffeineMax:40,caffeineEstimated:false,noMilk:!milk.length});
const drinks=[drink('green','綠茶'),drink('green2','綠茶'),drink('black','紅茶'),drink('milk','紅茶',['鮮奶']),drink('pearl','紅茶',['鮮奶'],['珍珠'])].map(d=>({...d,tea:Array.isArray(d.tea)?d.tea:[d.tea]}));
const engine=makeEngine(drinks);
const semantic={scores:drinks.map(d=>({id:d.id,score:1})),modelVersion:'macbert-test',durationMs:1};
const relgt={scores:drinks.map(d=>({id:d.id,score:1})),modelVersion:'relgt-temporal-test',durationMs:1,historyCount:1};
const rank=(likedIds:string[]=[],dislikedIds:string[]=[],filters={})=>engine.recommendWithTrace(validateInput({query:'茶',likedIds,dislikedIds,filters}),semantic,relgt,true);
test('fixed model scores respond to like/dislike and removing either removes its live contribution',()=>{
 const original=rank(),liked=rank(['green']),disliked=rank([],['green']);
 const row=(r:ReturnType<typeof rank>,id:string)=>r.trace.fusion.ranked.find(x=>x.id===id)!;
 assert.ok(row(liked,'green2').totalScore>row(original,'green2').totalScore);
 assert.ok(row(disliked,'green2').totalScore<row(original,'green2').totalScore);
 assert.ok(disliked.response.results.every(x=>x.id!=='green'));
 assert.deepEqual(rank().response,original.response);
 assert.equal(row(rank(),'green2').preferenceContribution,0);
 assert.equal(liked.response.mode.routeB,'relgt');assert.equal(liked.trace.fusion.livePreferences.modelWeightsUpdated,false);
 for(const r of liked.trace.fusion.ranked)assert.ok(Math.abs(r.totalScore-r.contributionA-r.contributionB-r.contributionSupplement-r.preferenceContribution)<1e-12);
});
test('one disliked milk drink only softly lowers similar drinks, never excludes the entire category',()=>{
 const result=rank([],['pearl']);assert.ok(result.response.results.some(x=>x.id==='milk'));
 assert.ok(result.trace.fusion.ranked.find(x=>x.id==='milk')!.preferenceContribution<0);
});
test('variants cannot multiply evidence, repeated evidence is bounded, unknown IDs do not personalize',()=>{
 const variant={...drinks[0],id:'green-large'};
 const scorer=(ids:string[])=>livePreferenceScorer([...drinks,variant],ids,[]).score(drinks[1]);
 assert.deepEqual(scorer(['green']),scorer(['green','green-large','green']));
 assert.equal(livePreferenceScorer(drinks,['missing'],[]).active,false);
 const lots=Array.from({length:200},(_,i)=>({...drinks[0],id:`x${i}`,name:`x${i}`}));
 const score=livePreferenceScorer(lots,lots.map(d=>d.id),[]).score(lots[0]);
 assert.ok(score.adjustment<=LIVE_PREFERENCE_CONFIG.likeWeight&&score.like<=1);
});
test('all caps and explicit exclusions still apply to every variant under positive boosts and cached scores',()=>{
 const result=rank(['milk','pearl'],[],{milk:'none',maxPrice:45,maxCalories:110,maxCaffeine:50,excludedBrands:['black']});
 assert.ok(result.response.results.length);
 for(const r of result.response.results)assert.ok(r.variants.every(v=>eligible(v,result.response.filters)));
 assert.equal(rank(['milk'],[],{maxPrice:0}).response.results.length,0);
});
test('an undisliked candidate omitted from the old model topK returns through a labelled local supplement',()=>{
 const ctx={...semantic,scores:[{id:'black',score:1}]};
 const result=engine.recommendWithTrace(validateInput({query:'茶'}),ctx,{...relgt,scores:[{id:'black',score:1}]},true);
 const green=result.trace.fusion.ranked.find(r=>r.id==='green')!;
 assert.ok(green);assert.equal(green.rankA,null);assert.equal(green.rankB,null);assert.ok(green.supplement);
 assert.ok(result.response.results.some(r=>r.id==='green'));
});
test('ranking contexts validate schema, app/catalog versions and bounded finite scores',()=>{
 const context={version:1,appVersion,catalogVersion,input:{query:'綠茶',filters:{maxPrice:50}},semantic,relgt};
 assert.equal(readRankingContext(context).input.filters.maxPrice,50);
 for(const mutation of [{version:2},{wellbeingGoals:['unknown']},{catalogVersion:'old'},{appVersion:'old'},{input:{query:'',filters:{maxPrice:-1}}},{semantic:{...semantic,scores:[{id:'x',score:NaN}]}},{semantic:{...semantic,scores:Array(101).fill({id:'x',score:1})}}])assert.throws(()=>readRankingContext({...context,...mutation}));
});
