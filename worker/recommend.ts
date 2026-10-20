import {concepts,searchable,tokenize,prepareLexicalIndex,type LexicalIndex} from './lexical';
export {searchable} from './lexical';
import {storeEligible,supplyStatus} from './stores';
import {regionEligible} from './regions';
import type { Drink, Filters, RecommendInput, Scored } from './types';
import {wellbeingAdvice} from './wellbeing';
import {appVersion} from './app-version';
import { understand } from './understand';
import {groupProducts,productKey,createProductPreferences} from './products';
import {milkTeaRetrievalQuery,requiredToppings,sameTopping} from './drink-language';
import {flavorQuery} from './numeric-language';
import {livePreferenceScorer,LIVE_PREFERENCE_CONFIG} from './live-preferences';

export const RANKING_CONFIG = {weightA: 0.65, weightB: 0.35, rrfK: 60, candidatesPerPath: 100, graphRounds: 3, graphRestart: 0.3, brandLimitFirstPass: 2} as const;
export const isMilkTea=(d:Drink)=>/奶茶|奶綠|奶青|奶烏龍/.test(d.name)||(d.milk.length>0&&d.tea.length>0);

export function toppingMatches(d:Drink,f:Filters):number {
  return requiredToppings(f).filter(t=>d.toppings.some(actual=>sameTopping(t,actual))).length;
}

export function eligible(d: Drink, f: Filters): boolean {
  return (!f.brand || d.brand === f.brand)
    && !(d.sourceKind==='nidin'&&(f.milkTea===false||!!f.excludedToppings?.length))
    && !f.excludedBrands?.includes(d.brand)
    && (f.maxPrice === undefined || (d.price !== null && !d.priceEstimated && (f.priceExclusive?d.price < f.maxPrice:d.price <= f.maxPrice)))
    && (f.maxCalories === undefined || (d.calories !== null && !d.caloriesEstimated && (f.caloriesExclusive?d.calories < f.maxCalories:d.calories <= f.maxCalories)))
    && (f.maxCaffeine === undefined || (d.caffeineMax !== null && !d.caffeineEstimated && (f.caffeineExclusive?d.caffeineMax < f.maxCaffeine:d.caffeineMax <= f.maxCaffeine)))
    && (!f.milk || f.milk === 'any' || (f.milk === 'none' ? d.noMilk && !d.milkConflict && !d.milk.length : f.milk === 'fresh' ? !d.milkConflict&&d.milk.includes('鮮奶')&&!d.milk.includes('奶精') : d.milk.includes('植物奶') && !d.milk.includes('鮮奶') && !d.milk.includes('奶精')))
    && (!f.tea || d.tea.includes(f.tea)) && (!requiredToppings(f).length || toppingMatches(d,f)>0)
    && (f.milkTea===undefined || (f.milkTea ? isMilkTea(d) : !isMilkTea(d)))
    && !(f.excludedToppings??[]).some(t=>{const names=['珍珠','波霸'].includes(t)?['珍珠','波霸']:[t];return names.some(n=>d.toppings.includes(n)||d.name.includes(n));});
}

export function makeEngine(drinks: Drink[],preferences=createProductPreferences(drinks),prepared?:LexicalIndex) {
  const byId = new Map(drinks.map(d => [d.id, d]));
  const index=prepared??prepareLexicalIndex(drinks);
  if(index.vectors.length!==drinks.length||index.norms.length!==drinks.length)throw Error('文字索引與目錄筆數不符');
  const dictionary=new Map(index.terms.map((term,i)=>[term,i])),df=index.frequency;
  const tokens=new Map(drinks.map((d,i)=>[d.id,index.vectors[i]]));
  const idf=(id:number)=>1+Math.log((1+drinks.length)/(1+(df[id]??0)));
  const weights=df.map((_,id)=>idf(id)**2);
  const norms=new Map(drinks.map((d,i)=>[d.id,index.norms[i]]));
  const contains=(vector:number[],id:number)=>{
    if(id<0)return false;let left=0,right=vector.length-1;
    while(left<=right){const middle=(left+right)>>>1,value=vector[middle];if(value===id)return true;if(value<id)left=middle+1;else right=middle-1;}
    return false;
  };
  const nodes = new Map<string, string[]>();
  const features = new Map(drinks.map(d => {
    const f = [`品牌:${d.brand}`, ...d.tea.map(t => `茶:${t}`), ...d.milk.map(t => `奶:${t}`), ...d.toppings.map(t => `料:${t}`), ...tokenize(d.taste).filter(t => t.startsWith('concept:'))];
    for (const key of f){const list=nodes.get(key);if(list)list.push(d.id);else nodes.set(key,[d.id]);}
    return [d.id, f];
  }));

  function lexical(query: string, pool: Drink[]): Scored[] {
    const qt = tokenize(query).map(token=>dictionary.get(token)??-1);
    const qNorm = Math.sqrt(qt.reduce((sum, t) => sum + idf(t) ** 2, 0));
    return pool.map(drink => {
      const vector = tokens.get(drink.id)!;
      const norm = norms.get(drink.id)!;
      const dot = qt.filter(t => contains(vector,t)).reduce((sum, t) => sum + weights[t], 0);
      const score = qNorm && norm ? dot / (qNorm * norm) : 0;
      return {drink, score};
    }).sort((a, b) => b.score - a.score || a.drink.id.localeCompare(b.drink.id));
  }

  function graph(seedIds: string[], pool: Drink[]): Scored[] {
    const seeds = seedIds.filter(id => byId.has(id));
    if (!seeds.length) return [];
    const restart = new Map(seeds.map(id => [id, 1 / seeds.length]));
    let scores = new Map(restart);
    // Personalised random walk on drink ↔ feature edges, with degree normalization.
    for (let iteration = 0; iteration < RANKING_CONFIG.graphRounds; iteration++) {
      const featureMass = new Map<string, number>();
      for (const [id, mass] of scores) {
        const fs = features.get(id)!;
        for (const f of fs) featureMass.set(f, (featureMass.get(f) ?? 0) + mass / fs.length);
      }
      const next = new Map<string, number>();
      for (const [f, mass] of featureMass) for (const id of nodes.get(f)!) next.set(id, (next.get(id) ?? 0) + (1 - RANKING_CONFIG.graphRestart) * mass / nodes.get(f)!.length);
      for (const [id, mass] of restart) next.set(id, (next.get(id) ?? 0) + RANKING_CONFIG.graphRestart * mass);
      scores = next;
    }
    return pool.map(drink => ({drink, score: scores.get(drink.id) ?? 0})).filter(d => d.score > 0).sort((a, b) => b.score - a.score || a.drink.id.localeCompare(b.drink.id));
  }

  function candidatePool(input:RecommendInput){
    const parsed=understand(input,[...new Set(drinks.map(d=>d.brand))]);
    const excluded=new Set(input.excludedIds),disliked=new Set(input.dislikedIds);
    const seen=new Set(input.excludedIds.flatMap(id=>byId.has(id)?[productKey(byId.get(id)!)]:[]));
    const dislikedProducts=new Set(input.dislikedIds.flatMap(id=>byId.has(id)?[productKey(byId.get(id)!)]:[]));
    return parsed.blocked?[]:drinks.filter(d=>eligible(d,parsed.filters)&&regionEligible(d,input.region)&&storeEligible(d,input.supply)&&!excluded.has(d.id)&&!disliked.has(d.id)&&!dislikedProducts.has(productKey(d))&&!seen.has(productKey(d)));
  }
  function recommendWithTrace(input: RecommendInput, semantic?:{scores:Array<{id:string;score:number}>;modelVersion:string;durationMs:number;fallbackReason?:string},relgt?:{scores:Array<{id:string;score:number}>;modelVersion:string;durationMs:number;historyCount?:number;fallbackReason?:string},reuseRanks=false) {
    const parsed = understand(input, [...new Set(drinks.map(d => d.brand))]);
    const wellbeing = wellbeingAdvice(input.query);
    input={...input,...preferences.normalize(input),query:flavorQuery(milkTeaRetrievalQuery(input.query,parsed.filters.milkTea===false))};
    const disliked = new Set(input.dislikedIds);
    const excluded = new Set(input.excludedIds);
    const seenProducts=new Set(input.excludedIds.flatMap(id=>byId.has(id)?[productKey(byId.get(id)!)]:[]));
    const dislikedProducts=new Set(input.dislikedIds.flatMap(id=>byId.has(id)?[productKey(byId.get(id)!)]:[]));
    const hardPool = parsed.blocked ? [] : drinks.filter(d => eligible(d, parsed.filters)&&regionEligible(d,input.region)&&storeEligible(d,input.supply));
    const likedPool = dislikedProducts.size?hardPool.filter(d => !dislikedProducts.has(productKey(d))):hardPool;
    const pool = excluded.size||seenProducts.size?likedPool.filter(d => !excluded.has(d.id)&&!seenProducts.has(productKey(d))):likedPool;
    const productGroups=groupProducts(pool);
    const poolIds=new Set(pool.map(d=>d.id));
    const neural=semantic&&!semantic.fallbackReason;
    const encoder=semantic?.modelVersion.startsWith('roberta-wwm-')?'roberta-wwm':'macbert';
    const encoderLabel=encoder==='roberta-wwm'?'RoBERTa-WWM':'MacBERT';
    const lexicalA = neural ? semantic.scores.filter(s=>poolIds.has(s.id)&&Number.isFinite(s.score)).map(s=>({drink:byId.get(s.id)!,score:s.score})).sort((a,b)=>b.score-a.score||a.drink.id.localeCompare(b.drink.id)) : lexical(input.query, pool);
    const liked = input.likedIds.filter(id => byId.has(id) && !disliked.has(id) && !parsed.filters.excludedBrands?.includes(byId.get(id)!.brand));
    const priorities=new Map(pool.map(d=>[d.id,(supplyStatus(d,input.supply).status==='available'?100:0)+toppingMatches(d,parsed.filters)]));
    const available=(d:Drink)=>(priorities.get(d.id)??0)>=100?1:0;
    const priority=(d:Drink)=>priorities.get(d.id)??0;
    const byTopping=(x:Scored,y:Scored)=>priority(y.drink)-priority(x.drink)||y.score-x.score||x.drink.id.localeCompare(y.drink.id);
    lexicalA.sort(byTopping);
    const a = liked.length && !input.query.trim() ? [] : lexicalA;
    const seeds = liked.length ? liked : lexicalA.filter(d => d.score > 0).slice(0, 5).map(d => d.drink.id);
    const neuralB=!!relgt&&!relgt.fallbackReason&&relgt.scores.length>0;
    const b = neuralB ? relgt.scores.filter(s=>poolIds.has(s.id)&&Number.isFinite(s.score)).map(s=>({drink:byId.get(s.id)!,score:s.score})).sort((x,y)=>y.score-x.score||x.drink.id.localeCompare(y.drink.id)) : graph(seeds, pool);
    b.sort(byTopping);
    const fused = new Map<string, {drink: Drink; score: number; aRank: number | null; bRank: number | null}>();
    for (const [path, list] of [['a', a], ['b', b]] as const) list.slice(0, RANKING_CONFIG.candidatesPerPath).forEach((item, index) => {
      const row = fused.get(item.drink.id) ?? {drink: item.drink, score: 0, aRank: null, bRank: null};
      row.score += (path === 'a' ? RANKING_CONFIG.weightA : RANKING_CONFIG.weightB) / (RANKING_CONFIG.rrfK + index + 1);
      if (path === 'a') row.aRank = index + 1; else row.bRank = index + 1;
      fused.set(item.drink.id, row);
    });
    // The inference service returns only its top 100. Preserve selected-topping
    // candidates omitted there so a better topping match cannot disappear.
    if(requiredToppings(parsed.filters).length)for(const drink of pool)if(!fused.has(drink.id))fused.set(drink.id,{drink,score:0,aRank:null,bRank:null});
    const live=livePreferenceScorer(drinks,liked,input.dislikedIds.filter(id=>byId.has(id)&&!parsed.filters.excludedBrands?.includes(byId.get(id)!.brand)),byId);
    // RRF has a fixed upper bound. Normalize against it, never compare raw model logits.
    const baseScale=1/(RANKING_CONFIG.rrfK+1);
    const supplements=new Map<string,{path:'a'|'b';rank:number;score:number}>();
    if(reuseRanks||input.supply){
      const supplement=(list:Scored[],path:'a'|'b')=>list.slice(0,RANKING_CONFIG.candidatesPerPath).forEach((item,index)=>{
        if(fused.get(item.drink.id)?.score)return;
        const rank=index+1,score=(path==='a'?RANKING_CONFIG.weightA:RANKING_CONFIG.weightB)/(RANKING_CONFIG.rrfK+rank);
        supplements.set(item.drink.id,{path,rank,score});
        fused.set(item.drink.id,{drink:item.drink,score,aRank:null,bRank:null});
      });
      if(a.length)supplement(lexical(input.query,pool),'a');
      supplement(graph(seeds,pool),'b');
    }
    if(input.supply)for(const d of pool)if(available(d)&&!fused.has(d.id))fused.set(d.id,{drink:d,score:0,aRank:null,bRank:null});
    const ranked = [...fused.values()].map(row=>{
      const preference=live.score(row.drink),baseScore=row.score;
      const supplemented=supplements.has(row.drink.id);
      return {...row,baseScore,preference,supplemented,score:baseScore+baseScale*preference.adjustment};
    }).sort(byTopping);
    const selected: typeof ranked = [];
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    const selectionDecisions: Array<{id: string; name: string; pass: string; decision: string; priorBrandCount: number}> = [];
    // First pass encourages brand diversity; second fills remaining slots without relaxing filters.
    const selectionTier=priority;
    const tiers=[...new Set(ranked.map(r=>selectionTier(r.drink)))].sort((a,b)=>b-a);
    for (const tier of tiers) for (const diverse of [true, false]) for (const row of ranked.filter(r=>selectionTier(r.drink)===tier)) {
      if (selected.length >= input.limit) break;
      const key = productKey(row.drink);
      const priorBrandCount = counts.get(row.drink.brand) ?? 0;
      const decision = seen.has(key) ? 'skip_duplicate_brand_name' : diverse && priorBrandCount >= RANKING_CONFIG.brandLimitFirstPass ? 'defer_brand_diversity' : 'select';
      selectionDecisions.push({id:row.drink.id, name:row.drink.name, pass:diverse ? 'brand_diversity' : 'fill_remaining', decision, priorBrandCount});
      if (decision !== 'select') continue;
      selected.push(row); seen.add(key); counts.set(row.drink.brand, (counts.get(row.drink.brand) ?? 0) + 1);
    }
    const response = {
      query: input.query, filters: parsed.filters, warnings: parsed.warnings, blocked: parsed.blocked, wellbeing,
      eligibleCount: pool.length, total: drinks.length,
      mode: {routeA: neural?encoder:'tf-idf',routeAModel:neural?semantic.modelVersion:null,routeAFallback:semantic?.fallbackReason??null,routeB: neuralB?'relgt':'feature-graph',routeBModel:neuralB?relgt!.modelVersion:null,routeBFallback:relgt?.fallbackReason??null,personalized:neuralB||live.active,livePreferences:live.active},
      results: selected.map(row => {
        const variants=productGroups.get(productKey(row.drink))!;
        variants.sort((x,y)=>toppingMatches(y,parsed.filters)-toppingMatches(x,parsed.filters));
        const d = variants[0];
        const reasons: string[] = [];
        const matched=requiredToppings(parsed.filters).filter(t=>d.toppings.some(actual=>sameTopping(t,actual)));
        if(matched.length)reasons.push(`符合所選配料 ${matched.length}/${requiredToppings(parsed.filters).length} 種：${matched.join('、')}（任一符合即可）`);
        for (const p of parsed.preferences) if (concepts[p]?.some(t => searchable(d).includes(t))) reasons.push(`風味包含${p}相關特徵`);
        if (parsed.filters.milk === 'none') reasons.push('資料標記為無奶');
        if (parsed.filters.maxPrice !== undefined) reasons.push(`資料記錄價格 ${d.price} 元，符合價格篩選`);
        if (parsed.filters.maxCaffeine !== undefined) reasons.push(`咖啡因資料上界 ${d.caffeineMax} mg`);
        if (parsed.filters.maxCalories !== undefined) reasons.push(`記錄熱量 ${d.calories} kcal`);
        if (neuralB && row.bRank !== null&&!row.supplemented) reasons.push('依你的歷史飲料互動進行 RelGT 排序');
        else if (liked.length && row.bRank !== null) reasons.push('與你喜歡的飲料共享品牌、茶種、奶類或風味特徵');
        if(row.preference.like>0)reasons.push('已依目前收藏的茶種、奶類、配料與風味調整排序');
        if(row.preference.dislike>0)reasons.push('已降低與目前不喜歡品項相似的特徵權重');
        if (!reasons.length) reasons.push(input.query ? '依飲料名稱與風味資料綜合排序' : '依目前條件列出可選飲料');
        const warnings = ['過敏原尚未核對，不能用於判斷成分安全。'];
        if (d.priceEstimated || d.caloriesEstimated || d.caffeineEstimated) warnings.push('部分數值為估算，需向店家確認。');
        if (d.calories === null || d.caffeineMax === null) warnings.push('部分營養資料未知。');
        if (/起/.test(d.priceText)) warnings.push('價格為起價，實際容量與加料可能另計。');
        return {availability:{...supplyStatus(d,input.supply),storeId:input.supply?.store.id??null},id: d.id, name: d.name, brand: d.brand, rankSourceId:row.drink.id, variants, match_score: Number(row.score.toFixed(6)), reasoning: reasons.join('；'), warning: warnings.join(' '), confidence: '資料完整度不等於推薦正確率，未校準機率', drink: d, reasons, ranks: {a: row.aRank, b: row.bRank}};
      }),
    };
    const trace = {
      schemaVersion: 1, engineVersion: appVersion, input:{...input,supply:undefined},store:input.supply?{id:input.supply.store.id,brand:input.supply.store.brand,excludedProducts:input.supply.excluded.size}:null,
      understanding: {...parsed, parser:'rules', llmUsed:false},
      filtering: {sourceTotal:drinks.length, afterHardFilters:hardPool.length, afterDislikes:likedPool.length, afterSeenExclusions:pool.length, unknownNutrientsPassCaps:false},
      config: RANKING_CONFIG,
      routeA: {method:neural?`${encoderLabel} mean-pooled normalized cosine on Mac`:'TF-IDF cosine / 中文二元片段與風味同義概念',modelVersion:neural?semantic.modelVersion:null,inferenceMs:neural?semantic.durationMs:null,fallbackReason:semantic?.fallbackReason??null,totalCandidates:a.length, ranked:a.slice(0,RANKING_CONFIG.candidatesPerPath).map((r,i)=>({rank:i+1,id:r.drink.id,name:r.drink.name,brand:r.drink.brand,sourceRow:r.drink.sourceRow,rawScore:r.score}))},
      routeB: {method:neuralB?'RelGT temporal next-like ranking on Mac CPU':'飲料↔特徵圖的個人化隨機遊走',modelVersion:neuralB?relgt!.modelVersion:null,inferenceMs:neuralB?relgt!.durationMs:null,historyCount:neuralB?relgt!.historyCount??null:null,fallbackReason:relgt?.fallbackReason??null, seedSource:neuralB?'past_interactions':liked.length ? 'favorites' : 'query_top5', seeds:neuralB?[]:seeds.map(id=>({id,name:byId.get(id)!.name,brand:byId.get(id)!.brand})), totalCandidates:b.length, ranked:b.slice(0,RANKING_CONFIG.candidatesPerPath).map((r,i)=>({rank:i+1,id:r.drink.id,name:r.drink.name,brand:r.drink.brand,sourceRow:r.drink.sourceRow,rawScore:r.score}))},
      fusion: {toppingPreference:'any selected topping; descending matched topping count before RRF score',method:'weighted reciprocal rank fusion', formula:'score = RRF + localSupplement + (0.22 * likeAffinity - 0.10 * dislikeAffinity) / 61; absent path contributes 0',livePreferences:{...LIVE_PREFERENCE_CONFIG,likedCount:live.likedCount,dislikedCount:live.dislikedCount,modelWeightsUpdated:false}, rawScoresDirectlyAdded:false, ranked:ranked.map((r,i)=>({rank:i+1,id:r.drink.id,name:r.drink.name,brand:r.drink.brand,rankA:r.aRank,rankB:r.bRank,contributionA:r.aRank === null ? 0 : RANKING_CONFIG.weightA/(RANKING_CONFIG.rrfK+r.aRank),contributionB:r.bRank === null ? 0 : RANKING_CONFIG.weightB/(RANKING_CONFIG.rrfK+r.bRank),baseScore:r.baseScore,supplement:supplements.get(r.drink.id)??null,contributionSupplement:supplements.get(r.drink.id)?.score??0,source:r.supplemented?'current lexical/graph supplement':'base ranking',preference:r.preference,preferenceContribution:r.score-r.baseScore,totalScore:r.score,calculation:`${r.aRank === null ? '0' : `0.65 / (60 + ${r.aRank})`} + ${r.bRank === null ? '0' : `0.35 / (60 + ${r.bRank})`} + ${supplements.get(r.drink.id)?.score??0} + ${r.score-r.baseScore}`}))},
      selection: {requestedLimit:input.limit, uniqueKey:'brand + name', firstPassBrandLimit:RANKING_CONFIG.brandLimitFirstPass, relaxHardFilters:false, decisions:selectionDecisions, finalOrder:selected.map((r,i)=>({rank:i+1,id:productGroups.get(productKey(r.drink))![0].id,rankSourceId:r.drink.id,name:r.drink.name,brand:r.drink.brand,originalFusionRank:ranked.indexOf(r)+1,score:r.score}))},
      consumerOutput:response,
      rendering: {source:'public/app.js card()', displayedFields:['name','brand','priceText','taste','calories','caffeineText','reasoning','sourceRow'], explanationAgentUsed:false, note:'畫面顯示推薦卡片；瀏覽器另持有最多各100筆模型分數的排名提示，供偏好刷新重用，不包含帳號識別或互動原文。'},
    };
    return {response, trace};
  }
  const recommend = (input: RecommendInput) => recommendWithTrace(input).response;
  return {recommend, recommendWithTrace, candidatePool,lexical, graph, byId};
}
