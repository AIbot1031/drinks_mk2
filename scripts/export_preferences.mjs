// Read only account IDs and preference snapshots; never export credentials.
import {execFileSync} from 'node:child_process';
import {createHmac, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.some(a => a !== '--local')) throw new Error('Only --local is supported');
const local = args.includes('--local');
const directory = path.resolve('internal_exports');
fs.mkdirSync(directory, {recursive: true, mode: 0o700});
const keyPath = path.join(directory, '.preference-pseudonym-key');
if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, randomBytes(32), {mode: 0o600, flag: 'wx'});
const key = fs.readFileSync(keyPath);
if (key.length !== 32) throw new Error('Invalid local pseudonym key');
const sql = "SELECT id,preferences FROM consumer_users WHERE lower(substr(id,1,8)) <> 'testauth' ORDER BY id";
const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', 'TRACE_DB', local ? '--local' : '--remote', '--command', sql, '--json'], {encoding: 'utf8', maxBuffer: 32*1024*1024});
const batches = JSON.parse(raw);
if (batches.some(b => b.success === false || b.error)) throw new Error('D1 export failed');
const rows = batches.flatMap(b => b.results ?? []);
const snapshot = {
  schema: 1, exported_at: new Date().toISOString(), source: local ? 'local-d1' : 'cloudflare-d1',
  kind: 'current-preference-snapshot', excluded_test_prefix: 'testauth',
  users: rows.map(row => {
    const p = JSON.parse(row.preferences);
    return {
      user_code: 'u_'+createHmac('sha256', key).update(row.id).digest('hex'),
      likedIds: p.likedIds ?? [], dislikedIds: p.dislikedIds ?? [],
    };
  }),
};
const file = path.join(directory, 'preferences-'+new Date().toISOString().replace(/[:.]/g, '-')+'.json');
fs.writeFileSync(file, JSON.stringify(snapshot, null, 2)+'\n', {mode: 0o600, flag: 'wx'});
console.log(`偏好快照：${file}；非測試帳號 ${snapshot.users.length} 個。`);
