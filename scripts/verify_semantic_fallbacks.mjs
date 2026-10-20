// Local-only protocol fault injection. Never disconnects production agents.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://localhost:8795';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Fault injection is local-only');
const WebSocket=createRequire(import.meta.url)('ws'),key=readFileSync('.semantic-key','utf8').trim();
const catalogVersion=createHash('sha256').update(readFileSync('data/catalog.json')).digest('hex');
const checks=[];let socket;
const post=async(path='/api/recommend',body={query:'',filters:{brand:'拾汣茶屋'},searchMode:'region',region:{city:'雲林縣',district:'虎尾鎮'}})=>{
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();
};
const pause=()=>new Promise(r=>setTimeout(r,30));
async function close(){if(socket){socket.terminate();socket=null;}for(let i=0;i<50;i++){const s=await fetch(base+'/api/semantic/status').then(r=>r.json());if(!s.ready)return;await pause();}throw Error('Mock did not disconnect');}
async function connect(mode,version=catalogVersion,ready=true){
 await close();socket=new WebSocket(base.replace(/^http/,'ws')+'/api/semantic/connect',{headers:{Authorization:'Bearer '+key}});
 socket.on('message',data=>{const job=JSON.parse(data);if(job.type!=='rank')return;
  if(mode==='ignore')return;
  if(mode==='disconnect'){socket.close();return;}
  if(mode==='error'){socket.send(JSON.stringify({type:'error',id:job.id}));return;}
  const scores=mode==='invalid'?[{id:'foreign',score:.5}]:[{id:job.candidateIds[0],score:.8}];
  socket.send(JSON.stringify({type:'result',id:job.id,result:{scores,modelVersion:'roberta-wwm-protocol-fixture',catalogVersion:version,durationMs:1}}));
 });
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 if(ready)socket.send(JSON.stringify({type:'ready',modelVersion:'roberta-wwm-protocol-fixture',catalogVersion:version,device:'cpu'}));
 for(let i=0;i<50;i++){const s=await fetch(base+'/api/semantic/status').then(r=>r.json());if(s.connected&&s.ready===ready)return;await pause();}throw Error('Mock not ready');
}
function check(name,value,reason){assert.equal(value.mode.routeA,'tf-idf');assert.equal(value.mode.routeAFallback,reason);checks.push({name,routeA:value.mode.routeA,reason});}
try{
 await close();const offline=await post();check('offline',offline,'model_not_ready');
 await connect('valid',catalogVersion,false);check('connected but not ready',await post(),'model_not_ready');
 await connect('valid','0'.repeat(64));check('stale index',await post(),'catalog_mismatch');
 await connect('invalid');check('foreign candidate reply',await post(),'invalid_reply');
 await connect('error');check('model explicit error',await post(),'no_valid_response');
 await connect('disconnect');check('disconnect during request',await post(),'no_valid_response');
 await connect('ignore');check('actual five second timeout',await post(),'no_valid_response');
 const concurrent=await Promise.all(Array.from({length:9},()=>post()));assert.ok(concurrent.some(v=>v.mode.routeAFallback==='model_busy'));checks.push({name:'concurrency cap',reason:'model_busy',requests:9});
 await connect('valid');
 const refresh=await post('/api/preference-refresh',{rankingContext:offline.rankingContext,searchMode:'region',region:{city:'雲林縣',district:'虎尾鎮'}});
 assert.equal(refresh.rankingReused,true);check('cached fallback stays honest during immediate preference refresh',refresh,'model_not_ready');
 const healthy=await post();assert.equal(healthy.mode.routeA,'roberta-wwm');checks.push({name:'new recommendation retries recovered model',routeA:healthy.mode.routeA});
 const empty=await post('/api/recommend',{query:'',filters:{maxPrice:0}});assert.equal(empty.mode.routeA,'not-run');assert.equal(empty.mode.routeB,'not-run');checks.push({name:'empty candidates',routeA:'not-run',routeB:'not-run'});
 const result={checkedAt:new Date().toISOString(),scope:'localhost only; mocked bridge protocol, not model accuracy or real inference',checks};
 writeFileSync('docs/model-validation/3.1.21TFIDF回退情境驗證.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await close();}
