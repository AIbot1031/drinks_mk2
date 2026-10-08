import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2),local=args.includes('--local');
const id=args.find(a=>!a.startsWith('--'));
if(id&&!/^[a-f0-9-]{36}$/.test(id))throw new Error('紀錄 ID 格式有誤');
const command=id?`SELECT id,payload FROM recommendation_traces WHERE id='${id}'`:'SELECT id,payload FROM recommendation_traces ORDER BY created_at DESC LIMIT 20';
const stdout=execFileSync('npx',['wrangler','d1','execute','TRACE_DB',local?'--local':'--remote','--command',command,'--json'],{encoding:'utf8',maxBuffer:16*1024*1024});
const output=JSON.parse(stdout);
const rows=output.flatMap(batch=>batch.results??[]);
await fs.mkdir('internal_exports',{recursive:true});
for(const row of rows){const file=path.resolve('internal_exports',`recommendation-${row.id}.json`);await fs.writeFile(file,JSON.stringify(JSON.parse(row.payload),null,2)+'\n');console.log(file);}
console.log(`已匯出 ${rows.length} 筆${local?'本機':'Cloudflare'}推薦過程。`);
