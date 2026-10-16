import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
export function versionedLock(lock,version){return {...lock,version,packages:{...lock.packages,'':{...lock.packages[''],version}}};}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const version=process.argv[2];if(!/^\d+\.\d+\.\d+$/.test(version??''))throw Error('Use node scripts/set_app_version.mjs x.y.z');
 const pkg=JSON.parse(await fs.readFile('package.json','utf8')),old=pkg.version;pkg.version=version;
 const lock=versionedLock(JSON.parse(await fs.readFile('package-lock.json','utf8')),version);
 await fs.writeFile('package.json',JSON.stringify(pkg,null,2)+'\n');await fs.writeFile('package-lock.json',JSON.stringify(lock,null,2)+'\n');
 for(const file of ['public/index.html','public/internal.html']){let s=await fs.readFile(file,'utf8');s=s.replaceAll(`版本 ${old}`,`版本 ${version}`);if(file.endsWith('internal.html'))s=s.replace(/(<span class="release-label">)[^<]+(<\/span>)/,(_,a,b)=>a+version+b);await fs.writeFile(file,s);}
}
