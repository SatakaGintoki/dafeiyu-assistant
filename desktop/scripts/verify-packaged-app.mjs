import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory=resolve(process.argv[2]);const output=resolve(process.argv[3]);
mkdirSync(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(join(directory,'大肥鱼管家.exe'),[`--dayu-verify=${output}`],{cwd:directory,env,windowsHide:true,stdio:'ignore'});
await new Promise((resolveDone,reject)=>{
 const timer=setTimeout(()=>{if(child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});reject(new Error('Packaged app verification timed out'));},45000);
 child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('Packaged app exited '+code));else resolveDone();});
});
const reports=readdirSync(output,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>join(output,e.name,'result.json'));
const report=reports.map(path=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return undefined;}}).find(r=>r?.ok);
assert.ok(report,'Missing successful packaged verification result');
assert.equal(report.version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
console.log('PASS packaged application: '+JSON.stringify(report));
