import {wellbeingSources} from './wellbeing';
import {appVersion} from './app-version';
import {catalogVersion} from './catalog-version';
import {validateInput} from './understand';
import type {RecommendInput} from './types';
export type RankScores={scores:Array<{id:string;score:number}>;modelVersion:string;durationMs:number;fallbackReason?:string;historyCount?:number};
export type RankingContext={version:1;appVersion:string;catalogVersion:string;input:Pick<RecommendInput,'query'|'filters'>;semantic?:RankScores;relgt?:RankScores;wellbeingGoals?:Array<keyof typeof wellbeingSources>};
// A browser-local ranking hint, not an authenticated model result. All filters and IDs
// are validated again and authenticated preferences always come from D1.
export function readRankingContext(value:unknown):RankingContext {
  if(!value||typeof value!=='object')throw Error('缺少推薦條件，請重新查詢。');
  const v=value as RankingContext;
  if(v.version!==1||v.appVersion!==appVersion||v.catalogVersion!==catalogVersion)throw Error('推薦版本已更新，請重新查詢。');
  const input=validateInput(v.input);
  if(v.wellbeingGoals!==undefined&&(!Array.isArray(v.wellbeingGoals)||v.wellbeingGoals.length>4||v.wellbeingGoals.some(k=>!Object.hasOwn(wellbeingSources,k))))throw Error('推薦情境格式有誤，請重新查詢。');
  const rank=(r:RankScores|undefined):RankScores|undefined=>{
    if(r===undefined)return;
    if(!r||!Array.isArray(r.scores)||r.scores.length>100||typeof r.modelVersion!=='string'||r.modelVersion.length>160||
      !Number.isFinite(r.durationMs)||r.durationMs<0||r.scores.some(s=>!s||typeof s.id!=='string'||s.id.length>80||!Number.isFinite(s.score))||
      (r.fallbackReason!==undefined&&(typeof r.fallbackReason!=='string'||r.fallbackReason.length>200)))throw Error('推薦排名格式有誤，請重新查詢。');
    return {scores:[...new Map(r.scores.map(s=>[s.id,{id:s.id,score:s.score}])).values()],modelVersion:r.modelVersion,durationMs:0,
      ...(r.fallbackReason?{fallbackReason:r.fallbackReason}:{}),...(typeof r.historyCount==='number'&&Number.isInteger(r.historyCount)&&r.historyCount>=0&&r.historyCount<=8?{historyCount:r.historyCount}:{})};
  };
  return {version:1,appVersion,catalogVersion,input:{query:input.query,filters:input.filters},semantic:rank(v.semantic),relgt:rank(v.relgt),wellbeingGoals:v.wellbeingGoals};
}
