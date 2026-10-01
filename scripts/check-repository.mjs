import { execFileSync } from 'node:child_process';
import { readFileSync,existsSync } from 'node:fs';
const failures=[];
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){
  if(/(^|\/)(node_modules|\.data|work|projects|package-resources|release)\//.test(file)||/(^|\/)(secrets\.json|api-token|\.env(?:\..+)?)$|\.sqlite(?:-wal|-shm)?$/.test(file)&&!file.endsWith('.env.example'))failures.push(`${file}: private/generated path is tracked`);
  const bytes=readFileSync(file);
  if(bytes.includes(0))continue;
  const source=bytes.toString('utf8');
  // Report paths only: never print a suspected credential into CI logs.
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)||/\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_\-]{32,}\b/.test(source))failures.push(`${file}: possible credential; review locally`);
}
const root=JSON.parse(readFileSync('package.json','utf8')).version;
for(const file of ['package-lock.json','desktop/package.json','desktop/package-lock.json']){
  const data=JSON.parse(readFileSync(file,'utf8'));
  if(data.version!==root||(data.packages?.['']&&data.packages[''].version!==root))failures.push(`${file}: version mismatch`);
}
if(!readFileSync('shared/version.ts','utf8').includes(`'${root}'`))failures.push('shared/version.ts: version mismatch');
if(!readFileSync('README.md','utf8').includes(`**${root}`))failures.push('README.md: version mismatch');
if(!existsSync('LICENSE'))console.log('Publication pending: project LICENSE has not been selected.');
if(failures.length){for(const issue of failures)console.error(issue);process.exitCode=1;}
else console.log(`PASS: ${files.length} tracked files and version ${root}; not a full history or security audit.`);
