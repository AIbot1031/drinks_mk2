// Only send allowlisted aggregates to the existing authenticated training service.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2);let base='https://drinks-mk2.rtx941031.workers.dev',keyFile='.semantic-key';
for(let i=0;i<args.length;i++){if(args[i]==='--base-url')base=args[++i];else if(args[i]==='--key-file')keyFile=args[++i];else throw Error('Unknown option');}
if(base!=='https://drinks-mk2.rtx941031.workers.dev'&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Unapproved dashboard destination');
const rows=JSON.parse(execFileSync('.venv-training/bin/python',['scripts/build_training_summaries.py'],{encoding:'utf8',maxBuffer:4*1024*1024}));const key=fs.readFileSync(keyFile,'utf8').trim();let count=0;
for(const row of rows){const r=await fetch(base+'/api/training/reports',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(row),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Training dashboard sync failed: HTTP '+r.status);count++;}
console.log('DASHBOARD_SUMMARIES_SYNCED='+count);
