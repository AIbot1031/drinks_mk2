// Replay frozen synthetic generations through the existing parser/Worker merge.
// This is a local merge probe, not an end-to-end production quality metric.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {conversationTurn} from '../worker/conversation';
import {applyLlmUnderstanding} from '../worker/llm-conversation';
import {validateInput} from '../worker/understand';
const directory=process.argv[2];if(!directory)throw new Error('Provide training run directory');
const normalized=(f:any)=>JSON.stringify(Object.fromEntries(Object.entries(f??{}).filter(([_,v])=>v!==undefined&&v!==null&&(!Array.isArray(v)||v.length)).map(([k,v])=>[k,Array.isArray(v)?[...v].sort():v]).sort(([a],[b])=>a.localeCompare(b))));
const legacy=new Map<string,any>();
for(const d of ['dev','holdout'])for(const c of JSON.parse(fs.readFileSync('.wrangler/qwen-robust-regression/'+d+'/qwen-fixtures.json','utf8')))legacy.set('regression-'+c.id,c.turn);
const versions:any={};
for(const stage of ['before','after']){
  const raw=JSON.parse(fs.readFileSync(directory+'/'+stage+'-evaluation.json','utf8'));
  const cases=raw.map((row:any)=>{
    const c=row.case,job=c.input;
    const turn=c.prior?conversationTurn({message:job.message,state:c.prior},job.brands):legacy.get(c.id);
    assert(turn,'Missing original Worker turn: '+c.id);
    assert.equal(normalized(turn.state.filters),normalized(job.state.filters));
    const hypothetical=structuredClone(turn);
    // Production codec removes numeric nulls and forces unknown-topping clarify.
    let parser=row.prediction&&typeof row.prediction==='object'&&!Array.isArray(row.prediction)?structuredClone(row.prediction):null;
    if(parser?.filters&&typeof parser.filters==='object')for(const key of ['maxPrice','maxCalories','maxCaffeine'])if(parser.filters[key]===null)delete parser.filters[key];
    if(parser&&job.state.guard?.startsWith('未辨識條件：'))Object.assign(parser,{action:'clarify',query:job.state.query,filters:job.state.filters});
    const reply=parser?{...parser,modelVersion:'qwen3.5-9b-4bit-robust-local-probe',durationMs:1}:null;
    const applied=applyLlmUnderstanding(hypothetical,reply,job.brands,job.tea,job.toppings);
    const modelRouted=!turn.reset&&!turn.next&&!turn.followUp&&!turn.constraintOnly&&!(/過敏|花生|堅果|乳糖不耐|麩質/.test(turn.state.guard)||(/忌口/.test(turn.state.guard)&&!turn.state.guard.startsWith('忌口：')));
    const parserPassed=!!parser&&parser.action===c.expected.action&&normalized(parser.filters)===normalized(c.expected.filters);
    const mergePassed=!!applied&&(applied.clarify?'clarify':'recommend')===c.expected.action&&normalized(applied.state.filters)===normalized(c.expected.filters);
    return {id:c.id,group:c.group,modelRouted,parserPassed,mergePassed,accepted:!!applied,
      inheritedRuleMismatch:normalized(job.state.filters)!==normalized(c.expected.filters)};
  });
  const routed=cases.filter((c:any)=>c.modelRouted);
  versions[stage]={total:cases.length,parserCorrect:cases.filter((c:any)=>c.parserPassed).length,mergeProbeCorrect:cases.filter((c:any)=>c.mergePassed).length,
    modelRouted:routed.length,routedMergeProbeCorrect:routed.filter((c:any)=>c.mergePassed).length,bypassed:cases.length-routed.length,cases};
}
const beforeById=new Map(versions.before.cases.map((c:any)=>[c.id,c]));
const regressions=versions.after.cases.filter((c:any)=>(beforeById.get(c.id) as any).parserPassed&&!c.parserPassed).map((c:any)=>c.id);
const mergeRegressions=versions.after.cases.filter((c:any)=>(beforeById.get(c.id) as any).mergePassed&&!c.mergePassed).map((c:any)=>c.id);
const result={method:'same frozen generations; production null codec / guard override and actual existing Worker merge only; not full HTTP/eligibility/ranking replay',versions,parserRegressions:regressions,mergeRegressions,
  publicationAttempted:false,limitations:['Some scenarios are bypassed by the real Worker; hypothetical merge results must not be claimed as production gains','Current merge rules restrict novel typo/English aliases and cannot repair every existing preprocessing error','No real-user ranking or satisfaction benchmark']};
fs.writeFileSync(directory+'/worker-merge-comparison.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({before:{parser:versions.before.parserCorrect,merge:versions.before.mergeProbeCorrect,routed:versions.before.modelRouted,routedMerge:versions.before.routedMergeProbeCorrect},after:{parser:versions.after.parserCorrect,merge:versions.after.mergeProbeCorrect,routedMerge:versions.after.routedMergeProbeCorrect},total:versions.before.total,parserRegressions:regressions,mergeRegressions}));
