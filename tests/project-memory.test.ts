import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../server/store';
import { Config } from '../server/config';
import { AgendaService } from '../server/agenda';
import { ProjectMemories } from '../server/project-memory';
import { TaskManager } from '../server/tasks';
import { ButlerTools } from '../server/tools';
import { DirectRuntime, runtimeContext } from '../server/runtime';
import { checkModelConnection } from '../server/connection-check';
import { createApp } from '../server/app';
import type { AgendaProject, AgendaItem } from '../shared/agenda';
import type { ProjectMemory, AgendaReference } from '../shared/project-memory';

function fixture(t:any){const dir=mkdtempSync(join(resolve('work'),'memory-test-'));const store=new Store(dir);const config=new Config(store,resolve('.'));const agenda=new AgendaService(store,()=>{});const memories=new ProjectMemories(store,()=>{});const tasks=new TaskManager(store,config,{run:async()=>({result:'demo',error:''})} as any,()=>{});const tools=new ButlerTools(tasks,store,config,agenda,memories);t.after(()=>store.close());return {dir,store,config,agenda,memories,tools};}
test('project memory survives restart, revisions prevent lost edits and replay does not resurrect deleted records',t=>{
 const f=fixture(t);const p=f.agenda.mutate('project.create',{name:'数据结构'}) as AgendaProject;
 const input={projectId:p.id,kind:'progress' as const,content:'做到删除节点'};
 const m=f.memories.mutate('create',undefined,input,'create');
 assert.deepEqual(f.memories.mutate('create',undefined,input,'create'),m);
 assert.throws(()=>f.memories.mutate('create',undefined,{...input,content:'不同内容'},'create'),/幂等/);
 const next=f.memories.mutate('update',m.id,{revision:1,content:'删除已完成'},'update');
 assert.throws(()=>f.memories.mutate('update',m.id,{revision:1,content:'旧数据覆盖'}),/刷新/);
 f.store.close();const reloaded=new Store(f.dir);t.after(()=>reloaded.close());const service=new ProjectMemories(reloaded,()=>{});
 assert.equal(service.list(p.id)[0].content,'删除已完成');
 assert.deepEqual(service.mutate('update',m.id,{revision:1,content:'删除已完成'},'update'),next);
 service.mutate('delete',m.id,{revision:2},'delete');service.mutate('delete',m.id,{revision:2},'delete');
 service.mutate('create',undefined,input,'create');assert.deepEqual(service.list(p.id),[]);
});
test('memory provenance uses user messages, rejects secrets and archived projects; coding projects are separate',async t=>{
 const f=fixture(t);const p=f.agenda.mutate('project.create',{name:'个人网站'}) as AgendaProject;
 const user=f.store.message('user','记住：先做首页');
 const args={operation:'create',payload:JSON.stringify({projectId:p.id,kind:'next',content:'先做首页'})};
 const m=await f.tools.execute('manage_project_memory',args,'memory-1') as ProjectMemory;
 assert.deepEqual(m.source,{type:'conversation',messageId:user.id});
 assert.equal((await f.tools.execute('query_project_memory',{projectId:p.id}) as any[]).length,1);
 const assistant=f.store.message('assistant','我猜测你喜欢蓝色');
 assert.throws(()=>f.memories.mutate('create',undefined,{projectId:p.id,kind:'context',content:'猜测'},undefined,assistant.id),/用户消息/);
 assert.throws(()=>f.memories.mutate('create',undefined,{projectId:p.id,kind:'context',content:'密码：private'}),/凭据/);
 assert.throws(()=>f.memories.list('00000000-0000-4000-8000-000000000000'),/不存在/);
 f.agenda.mutate('project.update',{id:p.id,revision:1,archived:true});
 assert.throws(()=>f.memories.mutate('update',m.id,{revision:1,content:'覆盖'}),/归档/);
 f.memories.mutate('delete',m.id,{revision:1});assert.equal(f.store.tasks().length,0);
});
test('agenda references resolve fresh focus, refuse same-title ambiguity and expire unrelated conversation focus',async t=>{
 const f=fixture(t);f.store.message('user','记作业');
 const item=await f.tools.execute('manage_agenda',{operation:'item.create',payload:JSON.stringify({title:'作业',kind:'todo'})},'item-1') as AgendaItem;
 f.store.message('user','这个完成了');
 let r=await f.tools.execute('resolve_agenda_reference',{}) as AgendaReference;
 assert.equal(r.status,'resolved');assert.equal(r.candidates[0].id,item.id);
 f.agenda.mutate('item.update',{id:item.id,revision:1,status:'done'});
 r=await f.tools.execute('resolve_agenda_reference',{}) as AgendaReference;assert.equal(r.candidates[0].revision,2);assert.equal(r.candidates[0].status,'done');
 f.agenda.mutate('item.create',{title:'作业',kind:'todo'});
 r=await f.tools.execute('resolve_agenda_reference',{query:'作业'}) as AgendaReference;assert.equal(r.status,'ambiguous');
 for(let i=0;i<4;i++)f.store.message('user','无关闲聊');
 assert.equal((await f.tools.execute('resolve_agenda_reference',{}) as AgendaReference).status,'missing');
});
test('Direct tool loop continues a real saved item without creating a duplicate (mock model)',async t=>{
 const f=fixture(t);f.config.update({apiKey:'test-not-real',runtime:'deepseek'});f.store.message('user','记作业');
 const item=await f.tools.execute('manage_agenda',{operation:'item.create',payload:JSON.stringify({title:'作业',kind:'todo'})}) as AgendaItem;
 f.store.message('user','刚才那项完成了');let calls=0;
 const runtime=new DirectRuntime(f.config,f.store,f.tools,async(_url,init)=>{
   const body=JSON.parse(init!.body as string);const step=calls++;
   assert.ok(body.tools.some((t:any)=>t.function.name==='query_project_memory'));
   const message=step===0?{tool_calls:[{id:'resolve',type:'function',function:{name:'resolve_agenda_reference',arguments:'{}'}}]}:step===1?{tool_calls:[{id:'done',type:'function',function:{name:'manage_agenda',arguments:JSON.stringify({operation:'item.update',payload:JSON.stringify({id:JSON.parse(body.messages.at(-1).content).candidates[0].id,revision:1,status:'done'})})}}]}:{content:'已完成。'};
   return Response.json({choices:[{message}]});
 });
 assert.equal(await runtime.reply('刚才那项完成了',new AbortController().signal,()=>{}),'已完成。');
 assert.equal(f.agenda.snapshot().items.length,1);assert.equal(f.agenda.get<AgendaItem>('items',item.id).status,'done');
});
test('model connection checks validate responses without revealing provider errors or dispatching tasks',async t=>{
 const f=fixture(t);f.config.update({runtime:'demo'});assert.equal((await checkModelConnection(f.config,async()=>{throw new Error('must not call');})).mode,'demo');
 f.config.update({runtime:'deepseek',apiKey:'test-not-real'});
 const result=await checkModelConnection(f.config,async(_url,init)=>{const body=JSON.parse(init!.body as string);assert.equal(body.max_tokens,16);assert.equal(body.tools,undefined);return Response.json({choices:[{message:{content:'OK'}}]});});assert.equal(result.mode,'api');
 await assert.rejects(checkModelConnection(f.config,async()=>new Response('secret provider body',{status:401})),/HTTP 401/);
 await assert.rejects(checkModelConnection(f.config,async()=>Response.json({choices:[]})),/有效文本/);assert.equal(f.store.tasks().length,0);
});
test('project context is retrievable beyond recent conversation, and deleted memory leaves the current index',async t=>{
 const f=fixture(t);const p=f.agenda.mutate('project.create',{name:'长期项目'}) as AgendaProject;
 const source=f.store.message('user','记住下一步：测试删除边界');
 const memory=f.memories.mutate('create',undefined,{projectId:p.id,kind:'next',content:'测试删除边界'},undefined,source.id);
 for(let i=0;i<30;i++)f.store.message('user',`其他话题 ${i}`);
 assert.ok(!runtimeContext(f.store,f.config).conversation.some(m=>m.content.includes('测试删除边界')));
 assert.equal((await f.tools.execute('query_project_memory',{projectId:p.id}) as ProjectMemory[])[0].content,'测试删除边界');
 assert.equal(runtimeContext(f.store,f.config).currentMemoryIndex[0].id,memory.id);
 f.memories.mutate('delete',memory.id,{revision:1});assert.deepEqual(runtimeContext(f.store,f.config).currentMemoryIndex,[]);
});
test('memory HTTP API requires authentication, enforces revision and demo connection check needs no credentials',async t=>{
 const service=createApp({root:resolve('.'),dataDir:mkdtempSync(join(resolve('work'),'memory-api-'))});service.config.update({runtime:'demo'});
 const server=service.app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await service.close();server.close();});
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/v1`;
 const p=service.agenda.mutate('project.create',{name:'测试项目'}) as AgendaProject;
 const request=(path:string,method='GET',body?:unknown)=>fetch(url+path,{method,headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json','Idempotency-Key':'http-'+method},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal((await fetch(url+'/project-memories?projectId='+p.id)).status,401);
 const created=await request('/project-memories','POST',{projectId:p.id,kind:'goal',content:'完成网站'});assert.equal(created.status,201);const m=await created.json() as ProjectMemory;
 assert.equal((await request('/project-memories/'+m.id,'PATCH',{revision:2,content:'冲突'})).status,409);
 assert.equal((await request('/project-memories/'+m.id,'DELETE',{revision:1})).status,200);
 assert.deepEqual(await (await request('/project-memories?projectId='+p.id)).json(),[]);
 assert.equal((await request('/connection-check','POST',{})).status,200);
});
