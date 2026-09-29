import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve,join } from 'node:path';
const desktop=resolve(import.meta.dirname,'..');
const {version}=JSON.parse(readFileSync(join(desktop,'package.json'),'utf8'));
const file=`Dafeiyu-Setup-${version}-x64.exe`;
const hash=createHash('sha256').update(readFileSync(join(desktop,'release',file))).digest('hex');
let commit='unknown';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:desktop,encoding:'utf8'}).trim();}catch{}
if(execFileSync('git',['status','--porcelain'],{cwd:desktop,encoding:'utf8'}).trim())throw new Error('Commit source changes before creating the release manifest');
const manifest={product:'大肥鱼管家',version,commit,file,sha256:hash,builtAt:new Date().toISOString(),signed:false};
writeFileSync(join(desktop,'release',`release-${version}.json`),JSON.stringify(manifest,null,2));
writeFileSync(join(desktop,'release',`SHA256SUMS-${version}.txt`),`${hash}  ${file}\n`);
console.log(JSON.stringify(manifest));
