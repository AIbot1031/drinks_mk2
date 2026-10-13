import fs from 'node:fs';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
const root='.wrangler/model-comparison/';
const fixtures=JSON.parse(fs.readFileSync(root+'qwen-fixtures.json','utf8'));
const raw=JSON.parse(fs.readFileSync(root+'qwen-raw.json','utf8'));
const normalized=(f:any)=>JSON.stringify(Object.fromEntries(Object.entries(f??{}).filter(([_,v])=>v!==undefined&&(!Array.isArray(v)||v.length)).map(([k,v])=>[k,Array.isArray(v)?[...v].sort():v]).sort(([a],[b])=>String(a).localeCompare(String(b)))));
const summary:any={kind:raw.kind,fixture_sha256:raw.fixture_sha256,versions:{}};
for(const [name,version] of Object.entries(raw.versions) as any){
  const cases=version.rows.map((row:any)=>{
    const f=fixtures.find((c:any)=>c.id===row.id),p=row.prediction;
    const reply=p?{...p,modelVersion:'qwen3-8b-4bit-validation-'+name,durationMs:1}:null;
    // Match Qwen.parse's production guard override before Worker merging.
    if(reply&&f.turn.state.guard.startsWith('未辨識條件：'))Object.assign(reply,{action:'clarify',query:f.turn.state.query,filters:f.turn.state.filters});
    const applied=applyLlmUnderstanding(f.turn,reply,f.job.brands,f.job.tea,f.job.toppings);
    const rawPassed=!!p&&p.action===f.expectedAction&&normalized(p.filters)===normalized(f.turn.state.filters);
    const finalPassed=!!applied&&(applied.clarify?'clarify':'recommend')===f.expectedAction&&normalized(applied.state.filters)===normalized(f.turn.state.filters);
    return {id:row.id,group:row.group,rawPassed,finalPassed,accepted:!!applied,
      expectedAction:f.expectedAction,expectedFilters:f.turn.state.filters,
      predictedAction:p?.action,predictedFilters:p?.filters,finalFilters:applied?.state.filters};
  });
  summary.versions[name]={cases,raw_correct:cases.filter((c:any)=>c.rawPassed).length,
    website_correct:cases.filter((c:any)=>c.finalPassed).length,total:cases.length};
}
summary.raw_regressions=summary.versions.candidate.cases.filter((c:any,i:number)=>summary.versions.online.cases[i].rawPassed&&!c.rawPassed).map((c:any)=>c.id);
summary.website_regressions=summary.versions.candidate.cases.filter((c:any,i:number)=>summary.versions.online.cases[i].finalPassed&&!c.finalPassed).map((c:any)=>c.id);
summary.promotion_allowed=summary.website_regressions.length===0&&summary.raw_regressions.length===0&&summary.versions.candidate.website_correct===fixtures.length;
fs.writeFileSync(root+'qwen.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({online:{raw:summary.versions.online.raw_correct,website:summary.versions.online.website_correct},candidate:{raw:summary.versions.candidate.raw_correct,website:summary.versions.candidate.website_correct},raw_regressions:summary.raw_regressions,website_regressions:summary.website_regressions,promotion_allowed:summary.promotion_allowed}));
