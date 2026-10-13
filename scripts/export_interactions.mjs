// Export timestamped interactions without credentials or login IDs in the snapshot.
import fs from 'node:fs';
import path from 'node:path';
import {createHmac,createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2);
let queryFile,local=false;
for(let i=0;i<args.length;i++){
  if(args[i]==='--query-file'&&args[i+1])queryFile=args[++i];
  else if(args[i]==='--local')local=true;
  else throw new Error('Use --local or --query-file <protected aggregate query result>');
}
const directory=path.resolve('internal_exports');fs.mkdirSync(directory,{recursive:true,mode:0o700});
const keyPath=path.join(directory,'.preference-pseudonym-key');
if(!fs.existsSync(keyPath))fs.writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
const key=fs.readFileSync(keyPath);if(key.length!==32)throw new Error('Invalid pseudonym key');
const cutoff=Date.now();
let raw;
if(queryFile){raw=JSON.parse(fs.readFileSync(queryFile,'utf8'));}
else if(!local){
  const serviceKey=fs.readFileSync('.semantic-key','utf8').trim();
  const response=await fetch(`https://drinks-mk2.rtx941031.workers.dev/api/training/events?cutoff_ms=${cutoff}`,{headers:{Authorization:'Bearer '+serviceKey}});
  if(!response.ok)throw new Error('Protected cloud interaction export failed');
  raw=await response.json();
  const expected=createHash('sha256').update(fs.readFileSync('data/catalog.json')).digest('hex');
  if(raw.catalogVersion!==expected)throw new Error('Cloud/local catalog mismatch');
}else {
  const sql=`SELECT id,user_id,drink_id,action,occurred_at,request_id,catalog_version FROM consumer_interactions WHERE lower(substr(user_id,1,8)) <> 'testauth' AND occurred_at<=${cutoff} ORDER BY occurred_at,id LIMIT 200001`;
  const value=JSON.parse(execFileSync('npx',['wrangler','d1','execute','TRACE_DB',local?'--local':'--remote','--command',sql,'--json'],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));
  if(value.some(v=>!v.success))throw new Error('Interaction export failed');
  raw={kind:'cloudflare-interaction-query',cutoff_ms:cutoff,rows:value.flatMap(v=>v.results??[])};
}
if(raw.kind!=='cloudflare-interaction-query'||!Number.isSafeInteger(raw.cutoff_ms)||!Array.isArray(raw.rows)||raw.rows.length>200000)throw new Error('Invalid/truncated query result');
const events=raw.rows.filter(r=>typeof r.user_id==='string'&&!r.user_id.toLowerCase().startsWith('testauth')).map(r=>({
  id:r.id,user_code:'u_'+createHmac('sha256',key).update(r.user_id).digest('hex'),
  drink_id:r.drink_id,action:r.action,occurred_at:r.occurred_at,request_id:r.request_id,catalog_version:r.catalog_version,
}));
const snapshot={schema:1,kind:'timestamped-consumer-interactions',source:local?'local-d1':'cloudflare-d1',
  exported_at:new Date().toISOString(),cutoff_ms:raw.cutoff_ms,
  catalog_sha256:createHash('sha256').update(fs.readFileSync('data/catalog.json')).digest('hex'),events};
const file=path.join(directory,'interactions-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
fs.writeFileSync(file,JSON.stringify(snapshot,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(`SNAPSHOT=${file}\n真實時間事件 ${events.length} 筆；有事件用戶 ${new Set(events.map(e=>e.user_code)).size} 位。`);
