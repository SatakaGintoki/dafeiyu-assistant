import { spawn } from 'node:child_process';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const resources=resolve(process.argv[2]);
const userData=mkdtempSync(join(tmpdir(),'dafeiyu-zcode-'));
const child=spawn(join(resources,'runtime/node.exe'),[join(resources,'backend/server/index.mjs')],{env:{...process.env,DAYU_USER_DATA:userData},windowsHide:true,stdio:['ignore','ignore','inherit','ipc']});
const closed=once(child,'exit');
try{
  const ready=await Promise.race([once(child,'message'),closed.then(()=>{throw new Error('Backend exited before ready');})]);
  assert.equal(ready[0].type,'ready');
  const token=readFileSync(join(userData,'data/api-token'),'utf8').trim();
  const call=async(path,body)=>{
    const response=await fetch(ready[0].url+'/api/v1'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.ok(response.ok);return response.json();
  };
  assert.ok((await call('/executors')).some(e=>e.id==='zcode'&&e.available));
  const task=await call('/tasks',{title:'打包版 ZCode 验收',executor:'zcode',instruction:'只在当前目录创建 packaged-zcode.txt，内容严格为 PACKAGED_ZCODE_OK。不要执行命令或访问其他目录。'});
  const deadline=Date.now()+90000;
  let final;
  do{
    await new Promise(r=>setTimeout(r,300));final=await call('/tasks/'+task.id);
    if(Date.now()>deadline){await call('/tasks/'+task.id+'/cancel',{});throw new Error('Task timed out');}
  }while(['queued','running','cancelling'].includes(final.status));
  assert.equal(final.status,'succeeded',final.error);
  assert.equal(readFileSync(join(userData,'projects/packaged-zcode.txt'),'utf8').trim(),'PACKAGED_ZCODE_OK');
  console.log('PASS: packaged backend detects ZCode, dispatches task and artifact matches.');
}finally{if(child.connected)child.send('shutdown');await closed;}
