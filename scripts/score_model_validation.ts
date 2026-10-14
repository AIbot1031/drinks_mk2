import fs from 'node:fs';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
const root=(process.argv[2]??'.wrangler/model-comparison').replace(/\/$/,'')+'/';
const fixtures=JSON.parse(fs.readFileSync(root+'qwen-fixtures.json','utf8'));
const raw=JSON.parse(fs.readFileSync(root+'qwen-raw.json','utf8'));
const normalized=(f:any)=>JSON.stringify(Object.fromEntries(Object.entries(f??{}).filter(([_,v])=>v!==undefined&&(!Array.isArray(v)||v.length)).map(([k,v])=>[k,Array.isArray(v)?[...v].sort():v]).sort(([a],[b])=>String(a).localeCompare(String(b)))));
const summary:any={kind:raw.kind,fixture_sha256:raw.fixture_sha256,versions:{}};
for(const [name,version] of Object.entries(raw.versions) as any){
  const cases=version.rows.map((row:any)=>{
    const f=fixtures.find((c:any)=>c.id===row.id),p=row.prediction;
    const parsed=row.parser_prediction??p;
    const reply=parsed?{...parsed,modelVersion:version.model_version??'qwen3-8b-4bit-validation-'+name,durationMs:1}:null;
    // Match Qwen.parse's production guard override before Worker merging.
    if(reply&&f.turn.state.guard.startsWith('未辨識條件：'))Object.assign(reply,{action:'clarify',query:f.turn.state.query,filters:f.turn.state.filters});
    const applied=applyLlmUnderstanding(f.turn,reply,f.job.brands,f.job.tea,f.job.toppings);
    const queryPassed=typeof p?.query==='string'&&(f.turn.state.filters.milkTea!==false||!/(?:奶茶|珍奶|奶綠|奶青|奶烏龍)/.test(p.query));
    const rawPassed=!!p&&p.action===f.expectedAction&&normalized(p.filters)===normalized(f.turn.state.filters)&&queryPassed;
    const parserPassed=!!parsed&&parsed.action===f.expectedAction&&normalized(parsed.filters)===normalized(f.turn.state.filters)&&queryPassed;
    const finalPassed=!!applied&&(applied.clarify?'clarify':'recommend')===f.expectedAction&&normalized(applied.state.filters)===normalized(f.turn.state.filters);
    const validFilterKeys=['brand','excludedBrands','excludedToppings','milkTea','milk','tea','topping','maxPrice','maxCalories','maxCaffeine'];
    const schemaPassed=!!p&&['recommend','clarify'].includes(p.action)&&typeof p.query==='string'&&p.query.length<=300&&p.filters&&typeof p.filters==='object'&&!Array.isArray(p.filters)&&typeof p.assistantMessage==='string'&&!!applied&&Object.entries(p.filters).every(([k,v])=>validFilterKeys.includes(k)&&v!==null);
    const parserSchemaPassed=!!parsed&&['recommend','clarify'].includes(parsed.action)&&typeof parsed.query==='string'&&parsed.query.length<=300&&parsed.filters&&typeof parsed.filters==='object'&&!Array.isArray(parsed.filters)&&typeof parsed.assistantMessage==='string'&&!!applied&&Object.entries(parsed.filters).every(([k,v])=>validFilterKeys.includes(k)&&v!==null);
    return {id:row.id,group:row.group,rawPassed,parserPassed,finalPassed,queryPassed,schemaPassed,parserSchemaPassed,accepted:!!applied,
      expectedAction:f.expectedAction,expectedFilters:f.turn.state.filters,
      predictedAction:p?.action,predictedFilters:p?.filters,finalFilters:applied?.state.filters};
  });
  summary.versions[name]={cases,raw_correct:cases.filter((c:any)=>c.rawPassed).length,
    schema_correct:cases.filter((c:any)=>c.schemaPassed).length,website_correct:cases.filter((c:any)=>c.finalPassed).length,total:cases.length};
  summary.versions[name].parser_correct=cases.filter((c:any)=>c.parserPassed).length;
  summary.versions[name].parser_schema_correct=cases.filter((c:any)=>c.parserSchemaPassed).length;
}
summary.raw_regressions=summary.versions.candidate.cases.filter((c:any,i:number)=>summary.versions.online.cases[i].rawPassed&&!c.rawPassed).map((c:any)=>c.id);
summary.website_regressions=summary.versions.candidate.cases.filter((c:any,i:number)=>summary.versions.online.cases[i].finalPassed&&!c.finalPassed).map((c:any)=>c.id);
summary.parser_regressions=summary.versions.candidate.cases.filter((c:any,i:number)=>summary.versions.online.cases[i].parserPassed&&!c.parserPassed).map((c:any)=>c.id);
summary.raw_output_gate_passed=summary.website_regressions.length===0&&summary.raw_regressions.length===0&&summary.versions.candidate.schema_correct===fixtures.length;
// Publication compares the served parser and website contracts against the
// current version. It does not require a language model to be infallible.
summary.promotion_allowed=summary.website_regressions.length===0&&summary.parser_regressions.length===0&&summary.versions.candidate.parser_correct>=summary.versions.online.parser_correct&&summary.versions.candidate.website_correct===fixtures.length&&summary.versions.candidate.parser_schema_correct===fixtures.length;
fs.writeFileSync(root+'qwen.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({online:{raw:summary.versions.online.raw_correct,website:summary.versions.online.website_correct},candidate:{raw:summary.versions.candidate.raw_correct,website:summary.versions.candidate.website_correct},raw_regressions:summary.raw_regressions,website_regressions:summary.website_regressions,promotion_allowed:summary.promotion_allowed}));
