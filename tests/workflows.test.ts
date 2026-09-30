import { APP_VERSION } from '../shared/version';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync,existsSync,symlinkSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { Checkpoints } from '../server/checkpoints';
import { createApp } from '../server/app';
import type { Task } from '../shared/types';

function temp(){mkdirSync('work',{recursive:true});return mkdtempSync(resolve('work/workflows-'));}
test('checkpoints list added, modified, deleted files and recover without overwriting',()=>{
  const dir=temp(),workspace=join(dir,'project');mkdirSync(workspace);
  writeFileSync(join(workspace,'a.txt'),'before');writeFileSync(join(workspace,'deleted.txt'),'keep');writeFileSync(join(workspace,'.env'),'secret');
  mkdirSync(join(workspace,'node_modules'));writeFileSync(join(workspace,'node_modules/skip.txt'),'skip');
  const cp=new Checkpoints(join(dir,'data'));
  const task={id:'checkpoint-test',workspace} as Task;task.checkpoint=cp.capture(task);
  writeFileSync(join(workspace,'a.txt'),'after');unlinkSync(join(workspace,'deleted.txt'));writeFileSync(join(workspace,'new.txt'),'new');
  task.checkpoint=cp.finish(task);
  assert.deepEqual(task.checkpoint.changes.map(c=>c.kind).sort(),['added','deleted','modified']);
  const recovered=cp.recover(task);
  assert.equal(readFileSync(join(recovered,'a.txt'),'utf8'),'before');assert.equal(readFileSync(join(workspace,'a.txt'),'utf8'),'after');
  assert.ok(existsSync(join(recovered,'deleted.txt')));assert.ok(!existsSync(join(recovered,'.env')));assert.ok(!existsSync(join(recovered,'new.txt')));
  assert.notEqual(cp.recover(task),recovered);
});
test('checkpoint skips junctions and rejects tampered recovery manifests',()=>{
  const dir=temp(),workspace=join(dir,'project'),outside=join(dir,'outside');mkdirSync(workspace);mkdirSync(outside);writeFileSync(join(outside,'private.txt'),'outside');
  symlinkSync(outside,join(workspace,'link'),'junction');writeFileSync(join(workspace,'a.txt'),'test');
  const cp=new Checkpoints(join(dir,'data'));const task={id:'tamper',workspace} as Task;task.checkpoint=cp.capture(task);assert.equal(task.checkpoint.files,1);
  const manifest=join(dir,'data/checkpoints/tamper/before.json');const data=JSON.parse(readFileSync(manifest,'utf8'));data.files['../../../escape']=Object.values(data.files)[0];writeFileSync(manifest,JSON.stringify(data));assert.throws(()=>cp.recover(task),/清单无效/);
});
test('workflow API persists projects/templates, diagnoses, checkpoints and recovers real tasks',async t=>{
  const root=temp(),other=join(root,'another');mkdirSync(other);writeFileSync(join(other,'before.txt'),'original');
  const service=createApp({root,runner:{async run(task){writeFileSync(join(task.workspace,'before.txt'),'changed');writeFileSync(join(task.workspace,'result.txt'),'artifact');return {result:'done'};}}});
  const server=service.app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  async function api(path:string,method='GET',body?:unknown){const res=await fetch(base+path,{method,headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:res.status===204?null:await res.json()};}
  assert.equal((await api('/projects','POST',{name:'sample',workspace:other,executor:'codex',notes:'Use Chinese'})).status,201);
  const project=(await api('/projects')).body[0];
  assert.equal((await api('/projects','POST',{name:'duplicate',workspace:other,executor:'demo'})).status,409);
  const taskResponse=await api('/tasks','POST',{title:'real',instruction:'work',projectId:project.id});assert.equal(taskResponse.status,201);
  const taskId=taskResponse.body.id;
  const deadline=Date.now()+5000;while(service.tasks.get(taskId).status!=='succeeded'){if(Date.now()>deadline)assert.fail('timeout');await delay(10);}
  const task=service.tasks.get(taskId);assert.equal(task.workspace,other);assert.ok(task.instruction.includes('Use Chinese'));assert.equal(task.checkpoint?.changes.length,2);
  assert.equal((await api(`/tasks/${taskId}/reveal`,'POST',{index:0})).status,200);
  const recovered=await api(`/tasks/${taskId}/recover`,'POST',{});assert.equal(recovered.status,200);assert.equal(readFileSync(join(recovered.body.path,'before.txt'),'utf8'),'original');
  assert.equal((await api('/tasks','POST',{title:'bad',instruction:'bad',projectId:project.id,workspace:root})).status,403);
  assert.equal((await api(`/projects/${project.id}/activate`,'POST',{})).status,200);
  assert.equal((await api('/settings')).body.workspace,other);
  const template=await api('/templates','POST',{name:'Template',instruction:'Do work'});assert.equal(template.status,201);assert.equal((await api('/templates')).body.length,1);
  assert.equal((await api(`/templates/${template.body.id}`,'DELETE')).status,204);
  service.store.put('preference','中文 key',{key:'中文 key',value:'中文'});await api('/preferences/remove','POST',{key:'中文 key'});assert.equal((await api('/preferences')).body.length,0);
  const diagnostics=(await api('/diagnostics')).body;assert.equal(diagnostics.version,APP_VERSION);assert.ok(!JSON.stringify(diagnostics).includes(service.token));
});
test('checkpoint size limit prevents executor launch',async t=>{
  const root=temp();const service=createApp({root,runner:{async run(){assert.fail('runner must not run');}}});t.after(()=>service.close());
  writeFileSync(join(root,'projects/large.bin'),Buffer.alloc(51*1024*1024));
  const task=service.tasks.create({title:'large',instruction:'work',executor:'codex'});
  const deadline=Date.now()+5000;while(['queued','running'].includes(service.tasks.get(task.id).status)){if(Date.now()>deadline)assert.fail('timeout');await delay(10);}
  assert.equal(service.tasks.get(task.id).status,'failed');assert.match(service.tasks.get(task.id).error,/检查点/);
});
