// Human labels + actual Worker preprocessing, never model-generated targets.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {conversationTurn} from '../worker/conversation';
import {catalogFeatures} from '../worker/catalog-features';
import {validateInput} from '../worker/understand';
import catalog from '../data/catalog.json';
const definitions=JSON.parse(execFileSync('.venv-llm/bin/python',['-m','training.qwen_robust_cases'],{encoding:'utf8'}));
const brands=Object.keys(catalog.brands),tea=[...new Set(catalog.drinks.flatMap(d=>d.tea))],toppings=[...new Set(catalog.drinks.flatMap(d=>d.toppings))];
const convert=(row:any)=>{
  const turn=conversationTurn({message:row.message,state:row.prior},brands);
  const expected=validateInput({query:row.expected.query,filters:row.expected.filters});
  assert.equal(expected.query,row.expected.query);
  const compact=(f:any)=>Object.fromEntries(Object.entries(f).filter(([_,v])=>v!==undefined&&(!Array.isArray(v)||v.length)));
  assert.deepEqual(compact(expected.filters),compact(row.expected.filters));
  assert(row.expected.action==='clarify'||row.expected.query||Object.keys(row.expected.filters).length);
  const input={message:row.message,state:turn.state,brands,tea,toppings,catalogFeatures:catalogFeatures(catalog.drinks),history:row.history,preferenceProfile:{}};
  return {id:row.id,group:row.group,input,expected:row.expected,queryAliases:row.queryAliases,
    labelSource:'manually authored semantic intent; never prediction labels',
    prior:row.prior,preprocessing:{next:turn.next,reset:turn.reset,followUp:turn.followUp??null}};
};
const rows=definitions.map(convert);
const regression=[];
for(const directory of ['.wrangler/qwen-robust-regression/dev','.wrangler/qwen-robust-regression/holdout']){
  const fixtures=JSON.parse(fs.readFileSync(directory+'/qwen-fixtures.json','utf8'));
  for(const c of fixtures)regression.push({id:'regression-'+c.id,group:'regression',input:c.job,
    expected:{action:c.expectedAction,query:c.turn.state.query,filters:c.turn.state.filters,assistantMessage:c.expectedAction==='clarify'?'請再說明你的口味。':'好，我保留條件幫你找飲料。'},
    queryAliases:[c.turn.state.query],labelSource:'existing untouched website-contract regression; query copied from rules, scored strictly'});
}
const snapshot={version:'intent-robust-v2-worker-contract',source:'human-authored synthetic scenarios + unchanged regression suite; no consumer data',
  split:'fixed train vs separately authored heldout compositions; existing 29 website cases are evaluation only',
  limitations:['Finite examples; not a real-user distribution','Human labels are authored by the coding assistant, not independently annotated','Quoted text, sarcasm and numeric ambiguity may remain unresolved','Some novel aliases cannot pass unchanged Worker merge rules even if the model learns them'],
  catalogSha256:createHash('sha256').update(fs.readFileSync('data/catalog.json')).digest('hex'),
  train:rows.filter((_:any,i:number)=>definitions[i].split==='train'),
  validation:[...rows.filter((_:any,i:number)=>definitions[i].split==='validation'),...regression]};
const hashes=(cases:any[])=>new Set(cases.map(c=>JSON.stringify(c.input)));
const trainingHashes=hashes(snapshot.train);
assert(snapshot.validation.every(c=>!trainingHashes.has(JSON.stringify(c.input))),JSON.stringify(snapshot.validation.filter(c=>trainingHashes.has(JSON.stringify(c.input))).map(c=>c.id)));
fs.writeFileSync('training/qwen_robust_snapshot.json',JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({train:snapshot.train.length,heldout:snapshot.validation.length-regression.length,regression:regression.length,totalValidation:snapshot.validation.length,groups:[...new Set(rows.map((r:any)=>r.group))]}));
