import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { Config } from '../server/config';
import { TaskManager } from '../server/tasks';
import { DirectRuntime } from '../server/runtime';
import { ButlerTools } from '../server/tools';
import { CliRunner, resolveExecutor, type Runner } from '../server/executors';
import type { Task } from '../shared/types';

const root=resolve('.'); mkdirSync(join(root,'work'),{recursive:true});
function temp(){return mkdtempSync(join(root,'work/test-'));}
async function waitFor(check:()=>boolean,ms=5000){const start=Date.now();while(!check()){if(Date.now()-start>ms)throw new Error('Timed out');await delay(15);}}
async function fixture(t:any,options:any={}) {
  const dataDir=temp();const service=createApp({root,dataDir,token:'test-token-abcdefghijklmnopqrstuvwxyz',...options});
  service.config.update({apiKey:''});
  const server=service.app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;service.setInternalUrl(url);
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  async function req(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){
    return fetch(url+path,{method,headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  }
  return {service,url,req,dataDir};
}

test('HTTP authentication, origin protection, malformed JSON and validation',async t=>{
  const {url,req}=await fixture(t);
  assert.equal((await fetch(url+'/health')).status,200);
  assert.equal((await fetch(url+'/api/v1/state')).status,401);
  assert.equal((await req('/api/v1/state','GET',undefined,{Origin:'https://evil.example'})).status,403);
  assert.equal((await req('/api/v1/state','GET',undefined,{Origin:'http://127.0.0.1:5173'})).status,200);
  assert.equal((await req('/api/v1/tasks','POST',{title:'',instruction:'x'})).status,400);
  assert.equal((await req('/api/v1/events','GET',undefined,{'Last-Event-ID':'NaN'})).status,400);
  const malformed=await fetch(url+'/api/v1/tasks',{method:'POST',headers:{Authorization:'Bearer test-token-abcdefghijklmnopqrstuvwxyz','Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);
  assert.equal((await req('/internal/tool','POST',{name:'list_tasks',args:{}})).status,401);
});

test('secrets never appear in settings/state, missing key fails honestly',async t=>{
  const {req,service}=await fixture(t);
  assert.equal((await req('/api/v1/chat','POST',{message:'你好'})).status,503);
  const response=await req('/api/v1/settings','PATCH',{apiKey:'sk-test-secret-123456789',nickname:'陈同学'});
  assert.equal(response.status,200);assert.equal((await response.json()).hasApiKey,true);
  const state=await (await req('/api/v1/state')).text();assert.ok(!state.includes('sk-test-secret'));
  assert.equal(service.config.redact('oops sk-test-secret-123456789'),'oops [REDACTED]');
  await req('/api/v1/settings','PATCH',{apiKey:''});assert.equal(service.config.value.hasApiKey,false);
});

test('demo queue lifecycle, notifications and idempotency',async t=>{
  const {req,service}=await fixture(t);
  const body={title:'演示',instruction:'仅演示',executor:'demo'};
  const first=await req('/api/v1/tasks','POST',body,{'Idempotency-Key':'same-task'});assert.equal(first.status,201);
  const task=await first.json();
  const duplicate=await (await req('/api/v1/tasks','POST',body,{'Idempotency-Key':'same-task'})).json();assert.equal(duplicate.id,task.id);
  assert.equal((await req('/api/v1/tasks','POST',{...body,title:'changed'},{'Idempotency-Key':'same-task'})).status,409);
  await waitFor(()=>service.tasks.get(task.id).status==='succeeded');
  assert.match(service.tasks.get(task.id).result,/没有调用真实模型/);
  assert.equal(service.store.messages().filter(m=>m.taskId===task.id).length,1);
  assert.ok(service.store.eventsAfter(0).some(e=>e.type==='task.updated'));
});

test('cancel running/queued tasks and continue processing the queue',async t=>{
  const runner:Runner={async run(_task,signal){await delay(30000,undefined,{signal});return {result:'never'};}};
  const {service}=await fixture(t,{runner});
  const a=service.tasks.create({title:'A',instruction:'a',executor:'demo'});
  const b=service.tasks.create({title:'B',instruction:'b',executor:'demo'});
  await waitFor(()=>service.tasks.get(a.id).status==='running');
  assert.equal((await service.tasks.cancel(b.id)).status,'cancelled');
  assert.equal((await service.tasks.cancel(a.id)).status,'cancelled');
  assert.equal(service.tasks.get(a.id).error,'用户取消任务');
});

test('failures are persisted and retry creates an explicit new task',async t=>{
  let count=0;const runner:Runner={async run(){if(++count===1)throw new Error('deliberate failure');return {result:'verified'};}};
  const {service}=await fixture(t,{runner});
  const first=service.tasks.create({title:'失败',instruction:'x'});await waitFor(()=>service.tasks.get(first.id).status==='failed');
  assert.match(service.tasks.get(first.id).error,/deliberate/);
  const next=service.tasks.retry(first.id);assert.notEqual(next.id,first.id);assert.equal(next.parentId,first.id);
  await waitFor(()=>service.tasks.get(next.id).status==='succeeded');
});

test('resume keeps the task, session, files and original checkpoint across a failed run',async t=>{
  let runs=0;
  const workspace=temp();writeFileSync(join(workspace,'result.txt'),'before');
  const runner:Runner={async run(task,_signal,update){
    if(++runs===1){
      update({sessionId:'saved-session-1'});update({log:'already wrote part one',result:'partial result'});
      writeFileSync(join(workspace,'result.txt'),'part one');throw new Error('permission denied for: Bash');
    }
    assert.equal(task.sessionId,'saved-session-1');assert.equal(task.resumeMode,'session');
    assert.equal(readFileSync(join(workspace,'result.txt'),'utf8'),'part one');
    assert.equal(task.attempts?.[0].result,'partial result');
    await delay(100);writeFileSync(join(workspace,'result.txt'),'finished');return {result:'done'};
  }};
  const {service,req}=await fixture(t,{runner});service.config.update({workspace});
  const first=service.tasks.create({title:'Continue me',instruction:'finish both parts',executor:'claude'});
  await waitFor(()=>service.tasks.get(first.id).status==='failed');
  assert.equal(service.tasks.get(first.id).sessionId,'saved-session-1');
  const response=await req(`/api/v1/tasks/${first.id}/resume`,'POST',{});
  assert.equal(response.status,200);assert.equal((await response.json()).id,first.id);
  assert.equal((await req(`/api/v1/tasks/${first.id}/resume`,'POST',{})).status,409);
  await waitFor(()=>service.tasks.get(first.id).status==='succeeded');
  assert.equal(service.store.tasks().length,1);assert.equal(runs,2);
  assert.equal(service.tasks.get(first.id).attempts?.[0].error,'permission denied for: Bash');
  const restored=service.tasks.recover(first.id);
  assert.equal(readFileSync(join(restored.path,'result.txt'),'utf8'),'before');
});

test('legacy tasks resume from files and running tasks cannot be resumed',async t=>{
  const {service}=await fixture(t,{runner:{async run(task:Task){assert.equal(task.resumeMode,'workspace');return {result:'continued'};}}});
  const now=new Date().toISOString();
  const old:Task={id:'legacy-task',title:'Old',instruction:'continue',executor:'demo',model:'',workspace:temp(),status:'interrupted',createdAt:now,updatedAt:now,result:'some work',error:'shutdown',logs:['old log']};
  service.store.put('task',old.id,old);
  assert.equal(service.tasks.resume(old.id).id,old.id);
  assert.throws(()=>service.tasks.resume(old.id),/只能继续/);
  await waitFor(()=>service.tasks.get(old.id).status==='succeeded');
  assert.ok(service.tasks.get(old.id).logs.includes('old log'));
});

test('Claude resume passes the exact saved session and preserves the selected permission mode',async()=>{
  const dir=temp(),script=join(dir,'fake-resume.mjs');
  writeFileSync(script,`let input='';for await(const chunk of process.stdin)input+=chunk;console.log(JSON.stringify({type:'result',subtype:'success',result:JSON.stringify({args:process.argv.slice(2),input}),session_id:'saved-session'}));`);
  const store=new Store(dir),config=new Config(store,root);config.update({claudePath:script,claudeFullAccess:false});
  try{
    const runner=new CliRunner(config);
    const task={id:'resume-cli',instruction:'remaining work',executor:'claude',workspace:dir,model:'',resumeMode:'session',sessionId:'saved-session',logs:['part one done'],attempts:[{error:'denied',result:'part one'}]} as Task;
    const result=JSON.parse((await runner.run(task,new AbortController().signal,()=>{})).result);
    assert.equal(result.args[result.args.indexOf('--resume')+1],'saved-session');
    assert.equal(result.args[result.args.indexOf('--permission-mode')+1],'dontAsk');
    assert.match(result.input,/这是原任务的继续执行/);assert.match(result.input,/part one/);
    const fallback=JSON.parse((await runner.run({...task,resumeMode:'workspace',sessionId:undefined},new AbortController().signal,()=>{})).result);
    assert.ok(!fallback.args.includes('--resume'));
  }finally{store.close();}
});

test('workspace escape is rejected and subfolder is allowed',async t=>{
  const {service}=await fixture(t);
  const project=temp(),child=join(project,'child'),outside=temp();mkdirSync(child);
  service.config.update({workspace:project});
  assert.throws(()=>service.tasks.create({title:'x',instruction:'x',workspace:outside}),/必须位于/);
  assert.throws(()=>service.tasks.create({title:'x',instruction:'x',workspace:'relative'}),/绝对路径/);
  const task=service.tasks.create({title:'x',instruction:'x',workspace:child,executor:'demo'});assert.equal(task.workspace,child);
  await service.tasks.cancel(task.id);
});

test('restart marks in-flight tasks interrupted without rerunning them',async()=>{
  const dir=temp();let store=new Store(dir);const now=new Date().toISOString();
  store.put('task','interrupted-id',{id:'interrupted-id',title:'Old',instruction:'x',workspace:root,executor:'demo',model:'',status:'running',createdAt:now,updatedAt:now,result:'',error:'',logs:[]});store.close();
  store=new Store(dir);let runs=0;const config=new Config(store,root);
  const manager=new TaskManager(store,config,{async run(){runs++;return {result:'no'};}},()=>{});
  assert.equal(manager.get('interrupted-id').status,'interrupted');manager.pump();assert.equal(runs,0);await manager.close();store.close();
});

test('settings cannot change while work is active, followup is a new queued task',async t=>{
  const {service,req}=await fixture(t,{runner:{async run(_task:Task,signal:AbortSignal){await delay(30000,undefined,{signal});return {result:''};}}});
  const original=service.tasks.create({title:'原任务',instruction:'x',executor:'demo'});await waitFor(()=>service.tasks.get(original.id).status==='running');
  assert.equal((await req('/api/v1/settings','PATCH',{nickname:'x'})).status,409);
  const followup=await (await req(`/api/v1/tasks/${original.id}/followup`,'POST',{instruction:'补充'})).json();
  assert.equal(followup.parentId,original.id);assert.equal(followup.status,'queued');
  await service.tasks.cancel(followup.id);await service.tasks.cancel(original.id);
});

test('offline chat is explicit, chat can be cancelled, concurrent send rejected',async t=>{
  const {req,service}=await fixture(t,{runtimeFactory:()=>({async reply(_input:string,signal:AbortSignal){await delay(30000,undefined,{signal});return 'never';},async close(){}})});
  service.config.update({runtime:'demo'});
  assert.equal((await req('/api/v1/chat','POST',{message:'你好'})).status,202);
  assert.equal((await req('/api/v1/chat','POST',{message:'第二条'})).status,409);
  assert.equal((await req('/api/v1/chat/cancel','POST',{})).status,200);
  assert.ok(service.store.messages().some(m=>m.content.includes('用户取消')));
});

test('SSE delivers persisted task events and supports Last-Event-ID',async t=>{
  const {url,service}=await fixture(t);const marker=service.emit('test.marker',{value:42});
  const controller=new AbortController();
  const response=await fetch(url+'/api/v1/events',{headers:{Authorization:'Bearer '+service.token,'Last-Event-ID':String(marker.seq-1)},signal:controller.signal});
  assert.match(response.headers.get('content-type')||'',/text\/event-stream/);
  const reader=response.body!.getReader();const text=new TextDecoder().decode((await reader.read()).value);
  assert.match(text,/test.marker/);assert.match(text,/sync.required/);controller.abort();
});

test('DeepSeek API tool loop dispatches once and returns the real answer',async()=>{
  const store=new Store(temp()),config=new Config(store,root);config.update({apiKey:'test-only',runtime:'deepseek'});
  const manager=new TaskManager(store,config,{async run(){return {result:'done'};}},()=>{});
  const tools=new ButlerTools(manager,store,config);
  store.message('assistant','旧任务的冗长执行日志，不应成为闲聊范本','old-task');
  store.message('user','创建演示任务');let calls=0;
  const fetcher:typeof fetch=async(_url,init)=>{
    const body=JSON.parse(init!.body as string);calls++;
    assert.match(body.messages[0].content,/默认只返回重点/);
    assert.ok(!body.messages[0].content.includes('已找到 '),'chat context must not include eager executor discovery');
    assert.match(body.messages[0].content,/需要检查程序可用性时调用 get_runtime_status/);
    assert.ok(!JSON.stringify(body.messages).includes('旧任务的冗长执行日志'));
    if(calls===1)return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'dispatch_task',arguments:JSON.stringify({title:'演示',instruction:'x',executor:'demo'})}}]}}]});
    assert.equal(body.messages.at(-1).role,'tool');assert.ok(JSON.parse(body.messages.at(-1).content).id);
    return Response.json({choices:[{message:{role:'assistant',content:'任务已排队。'}}]});
  };
  const runtime=new DirectRuntime(config,store,tools,fetcher);assert.equal(await runtime.reply('x',new AbortController().signal,()=>{}),'任务已排队。');
  assert.equal(store.tasks().length,1);await manager.close();store.close();
});

test('DeepSeek errors never silently fall back to demo',async()=>{
  const store=new Store(temp()),config=new Config(store,root);config.update({apiKey:'test-only'});store.message('user','hi');
  const manager=new TaskManager(store,config,{async run(){return {result:''};}},()=>{});
  const runtime=new DirectRuntime(config,store,new ButlerTools(manager,store,config),async()=>new Response('',{status:401}));
  await assert.rejects(()=>runtime.reply('x',new AbortController().signal,()=>{}),/HTTP 401/);await manager.close();store.close();
});

test('CLI runner handles a real child process and sends prompt via stdin',async()=>{
  const dir=temp(),script=join(dir,'fake-codex.mjs');
  writeFileSync(script,`let input=''; for await(const chunk of process.stdin) input+=chunk; console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input.includes('literal $(test)')?'stdin-safe':'wrong'}})); console.log(JSON.stringify({type:'turn.completed'}));`);
  const store=new Store(dir),config=new Config(store,root);config.update({codexPath:script});
  const runner=new CliRunner(config);const task={id:'test',instruction:'literal $(test)',executor:'codex',workspace:dir,model:''} as Task;
  const result=await runner.run(task,new AbortController().signal,()=>{});assert.equal(result.result,'stdin-safe');store.close();
});

test('CLI runner rejects exit-zero error payload and cancels a process',async()=>{
  const dir=temp(),script=join(dir,'fake-claude.mjs');writeFileSync(script,`process.stdin.resume();console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'provider denied'}));`);
  const store=new Store(dir),config=new Config(store,root);config.update({claudePath:script});const runner=new CliRunner(config);
  const task={id:'test',instruction:'hi',executor:'claude',workspace:dir,model:''} as Task;
  await assert.rejects(()=>runner.run(task,new AbortController().signal,()=>{}),/provider denied/);
  writeFileSync(script,`process.stdin.resume();setInterval(()=>{},1000);`);const controller=new AbortController();setTimeout(()=>controller.abort(new Error('cancelled-test')),150);
  await assert.rejects(()=>runner.run(task,controller.signal,()=>{}),/cancelled-test/);store.close();
});

test('executor resolver rejects shell command strings',()=>{
  assert.equal(resolveExecutor('claude','claude && evil'),undefined);
  assert.equal(resolveExecutor('codex','not-an-absolute-path'),undefined);
});

test('one data directory cannot have two live stores',()=>{
  const dir=temp(),first=new Store(dir);
  assert.throws(()=>new Store(dir),/另一个服务/);
  first.close();const second=new Store(dir);second.close();
});

test('API endpoint validation rejects secret-bearing URLs and remote HTTP',()=>{
  const dir=temp(),store=new Store(dir),config=new Config(store,root);
  assert.throws(()=>config.update({baseUrl:'https://example.com/?key=secret'}),/API 地址/);
  assert.throws(()=>config.update({baseUrl:'http://example.com'}),/API 地址/);
  store.close();
});

test('pet state follows background work and OpenAPI exposes backend contracts',async t=>{
  const {service,req}=await fixture(t,{runner:{async run(_task:Task,signal:AbortSignal){await delay(30000,undefined,{signal});return {result:''};}}});
  const task=service.tasks.create({title:'后台任务',instruction:'x',executor:'demo'});
  await waitFor(()=>service.tasks.get(task.id).status==='running');
  assert.equal((await (await req('/api/v1/state')).json()).petState,'working');
  const contract=await (await req('/api/v1/openapi.json')).json();assert.equal(contract.openapi,'3.1.0');assert.ok(contract.paths['/api/v1/tasks/{id}/followup']);
  await service.tasks.cancel(task.id);
  assert.equal((await (await req('/api/v1/state')).json()).petState,'idle');
});
