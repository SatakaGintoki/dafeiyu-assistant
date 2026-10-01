import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store';
import { AgendaService } from '../server/agenda';
import { occurrences } from '../server/agenda-time';
import { createApp } from '../server/app';
import { Config } from '../server/config';
import { TaskManager } from '../server/tasks';
import { ButlerTools } from '../server/tools';
import { DirectRuntime, runtimeContext } from '../server/runtime';
import { agendaResponseSchemas } from '../server/agenda-openapi';
import type { AgendaItem, AgendaNotification, AgendaPlan, AgendaProject } from '../shared/agenda';
import type { Task } from '../shared/types';

const root=resolve('.');mkdirSync(join(root,'work'),{recursive:true});
function dir(){return mkdtempSync(join(root,'work/agenda-test-'));}
function fixture(t:any){
  const path=dir(),store=new Store(path);let now=Date.parse('2026-10-01T08:00:00Z');const events:any[]=[];
  const agenda=new AgendaService(store,(type,data)=>{events.push({type,data});return store.event(type,data);},()=>now);
  t.after(()=>{agenda.close();store.close();});
  const mutate=<T=any>(op:string,data:any,key?:string)=>agenda.mutate(op,data,key) as T;
  return {agenda,store,path,events,mutate,setTime:(value:string)=>{now=Date.parse(value);}};
}

test('general projects, conflict detection, durable deduplication and independent coding data',t=>{
  const f=fixture(t);const p=f.mutate<AgendaProject>('project.create',{name:'搬家'},'create-move');
  assert.deepEqual(f.mutate('project.create',{name:'搬家'},'create-move'),p);
  assert.throws(()=>f.mutate('project.create',{name:'旅行'},'create-move'),/幂等/);
  assert.throws(()=>f.mutate('project.create',{name:'搬家'}),/同名/);
  const i=f.mutate<AgendaItem>('item.create',{title:'联系搬家公司',kind:'todo',projectId:p.id});
  assert.equal(f.store.tasks().length,0);assert.deepEqual(f.store.list('project'),[]);
  const next=f.mutate('item.update',{id:i.id,revision:1,notes:'明天询价'});assert.equal(next.revision,2);
  assert.throws(()=>f.mutate('item.update',{id:i.id,revision:1,status:'done'}),/刷新/);
  f.store.close();const reloaded=new Store(f.path);t.after(()=>reloaded.close());
  const other=new AgendaService(reloaded,()=>{});
  assert.equal(other.snapshot().items[0].notes,'明天询价');
  assert.deepEqual(other.mutate('project.create',{name:'搬家'},'create-move'),p);
});

test('strict validation of item kinds, references, dates, timezones and recurrence',t=>{
  const {mutate}=fixture(t);
  for(const body of [
    {title:'x',kind:'event'},
    {title:'x',kind:'todo',startsAt:'2026-10-01T08:00:00Z'},
    {title:'x',kind:'note',reminderAt:'2026-10-01T08:00:00Z'},
    {title:'x',kind:'todo',dueAt:'2026-10-01T08:00:00'},
    {title:'x',kind:'todo',dueAt:'2026-02-30T08:00:00Z'},
    {title:'x',kind:'todo',timezone:'Moon/Base'},
    {title:'x',kind:'todo',reminderMinutesBefore:10},
    {title:'x',kind:'todo',extra:'bad'},
    {title:'x',kind:'todo',projectId:'00000000-0000-4000-8000-000000000000'},
    {title:'x',kind:'event',startsAt:'2026-10-01T08:00:00Z',endsAt:'2026-10-01T09:00:00Z',recurrence:{frequency:'weekly',until:'2026-09-01'}},
  ])assert.throws(()=>mutate('item.create',body),JSON.stringify(body));
});

test('weekly wall time survives DST; interval, exclusions, end date and overlap work',t=>{
  const {mutate}=fixture(t);
  const item=mutate<AgendaItem>('item.create',{title:'每周讨论',kind:'event',timezone:'America/New_York',startsAt:'2026-10-26T09:00:00-04:00',endsAt:'2026-10-26T10:00:00-04:00',reminderMinutesBefore:15,recurrence:{frequency:'weekly',weekdays:[1],until:'2026-11-16',exceptions:['2026-11-09']}});
  const list=occurrences(item,'2026-10-26T13:30:00Z','2026-11-30T00:00:00Z');
  assert.deepEqual(list.map(o=>o.startsAt),['2026-10-26T13:00:00.000Z','2026-11-02T14:00:00.000Z','2026-11-16T14:00:00.000Z']);
  assert.equal(list[1].reminderAt,'2026-11-02T13:45:00.000Z');
  const fortnight={...item,recurrence:{...item.recurrence!,interval:2,exceptions:[]}};
  assert.equal(occurrences(fortnight,'2026-10-01T00:00:00Z','2026-12-01T00:00:00Z').length,2);
  assert.throws(()=>occurrences(item,'2026-01-01T00:00:00Z','2028-01-01T00:00:00Z'),/366/);
});

test('DST gap policy is compatible (shift forward), recurrence is bounded to start',t=>{
  const {mutate}=fixture(t);
  const item=mutate<AgendaItem>('item.create',{title:'起床',kind:'event',timezone:'America/New_York',startsAt:'2026-03-07T02:30:00-05:00',endsAt:'2026-03-07T03:00:00-05:00',recurrence:{frequency:'daily',until:'2026-03-09'}});
  assert.deepEqual(occurrences(item,'2026-03-01T00:00:00Z','2026-03-10T00:00:00Z').map(x=>x.startsAt),['2026-03-07T07:30:00.000Z','2026-03-08T07:30:00.000Z','2026-03-09T06:30:00.000Z']);
});

test('reminders survive restart, deliver once, snooze, acknowledge without completing item',t=>{
  const f=fixture(t);const item=f.mutate<AgendaItem>('item.create',{title:'预约体检',kind:'todo',reminderAt:'2026-10-01T08:01:00Z'});
  f.agenda.tick();assert.equal(f.agenda.snapshot().notifications.length,0);
  f.setTime('2026-10-01T08:02:00Z');f.agenda.tick();f.agenda.tick();
  let n=f.agenda.snapshot().notifications[0];assert.equal(f.events.filter(e=>e.type==='agenda.reminder').length,1);
  n=f.mutate('notification.action',{id:n.id,revision:n.revision,action:'snooze',until:'2026-10-01T08:05:00Z'});
  f.store.close();const reloaded=new Store(f.path);t.after(()=>reloaded.close());let now=Date.parse('2026-10-01T08:06:00Z');
  const a=new AgendaService(reloaded,()=>{},()=>now);a.tick();n=a.snapshot().notifications[0];assert.equal(n.status,'pending');assert.equal(n.revision,3);assert.equal(n.deliveryGeneration,2);
  a.mutate('notification.action',{id:n.id,revision:n.revision,action:'acknowledge'});a.tick();assert.equal(a.snapshot().notifications.length,0);
  assert.equal(a.get<AgendaItem>('items',item.id).status,'open');
});

test('completion cancels pending and snoozed reminders; edits do not resurrect delivered reminders',t=>{
  const f=fixture(t);const item=f.mutate<AgendaItem>('item.create',{title:'报告',kind:'todo',reminderAt:'2026-10-01T07:59:00Z'});f.agenda.tick();
  const edited=f.mutate<AgendaItem>('item.update',{id:item.id,revision:1,title:'完成报告'});f.agenda.tick();
  let n=f.agenda.snapshot().notifications[0];assert.equal(n.title,'完成报告');assert.equal(f.events.filter(e=>e.type==='agenda.reminder').length,1);
  f.mutate('notification.action',{id:n.id,revision:n.revision,action:'snooze',until:'2026-10-01T09:00:00Z'});
  f.mutate('item.update',{id:edited.id,revision:edited.revision,status:'done'});
  f.setTime('2026-10-01T10:00:00Z');f.agenda.tick();assert.equal(f.agenda.snapshot().notifications.length,0);
  f.mutate('item.update',{id:edited.id,revision:3,status:'open'});f.agenda.tick();assert.equal(f.agenda.snapshot().notifications.length,0);
});

test('rescheduling cancels old reminder and publishes the new due time',t=>{
  const f=fixture(t);const item=f.mutate<AgendaItem>('item.create',{title:'提交',kind:'todo',dueAt:'2026-10-01T08:00:00Z',reminderMinutesBefore:0});f.agenda.tick();
  f.mutate('item.update',{id:item.id,revision:1,dueAt:'2026-10-01T09:00:00Z'});assert.equal(f.agenda.snapshot().notifications.length,0);
  f.setTime('2026-10-01T09:00:01Z');f.agenda.tick();assert.equal(f.agenda.snapshot().notifications[0].scheduledAt,'2026-10-01T09:00:00.000Z');
});

test('quiet hours defer reminders and project archival pauses future reminders',t=>{
  const f=fixture(t);const p=f.mutate<AgendaProject>('project.create',{name:'健康'});
  f.mutate('preferences.update',{timezone:'Asia/Shanghai',quietStart:'15:00',quietEnd:'17:00'});
  const i=f.mutate<AgendaItem>('item.create',{title:'喝水',kind:'todo',projectId:p.id,reminderAt:'2026-10-01T08:00:00Z'});
  f.agenda.tick();assert.equal(f.agenda.snapshot().notifications.length,0);
  f.setTime('2026-10-01T09:00:00Z');f.agenda.tick();assert.equal(f.agenda.snapshot().notifications.length,1);
  f.mutate('project.update',{id:p.id,revision:1,archived:true});assert.equal(f.agenda.snapshot().notifications.length,0);
  assert.throws(()=>f.mutate('item.create',{title:'新增',kind:'todo',projectId:p.id}),/归档/);
  assert.equal(f.agenda.get<AgendaItem>('items',i.id).status,'open');
});

test('missed recurring reminders collapse to latest occurrence, next occurrence still fires',t=>{
  const f=fixture(t);
  f.mutate('item.create',{title:'晨会',kind:'event',timezone:'UTC',startsAt:'2026-09-01T07:00:00Z',endsAt:'2026-09-01T08:00:00Z',reminderMinutesBefore:0,recurrence:{frequency:'daily'}});
  f.agenda.tick();assert.equal(f.agenda.snapshot().notifications.length,1);
  assert.equal(f.agenda.snapshot().notifications[0].scheduledAt,'2026-10-01T07:00:00.000Z');
  f.setTime('2026-10-02T08:00:00Z');f.agenda.tick();assert.equal(f.agenda.snapshot().notifications.length,2);
});

test('plans remain drafts; acceptance creates linked items atomically and only once',t=>{
  const f=fixture(t);const p=f.mutate<AgendaPlan>('plan.create',{title:'整理旅行材料',steps:[{title:'列清单'},{title:'预订车票',dueAt:'2026-10-02T08:00:00Z'}]});
  assert.equal(f.agenda.snapshot().items.length,0);
  const accepted=f.mutate<AgendaPlan>('plan.accept',{id:p.id,revision:1},'accept-once');
  assert.equal(accepted.itemIds.length,2);assert.ok(f.agenda.snapshot().items.every(i=>i.planId===p.id));
  f.mutate('plan.accept',{id:p.id,revision:1},'accept-once');assert.equal(f.agenda.snapshot().items.length,2);
  assert.throws(()=>f.mutate('plan.accept',{id:p.id,revision:2}),/已处理/);
  const draft=f.mutate<AgendaPlan>('plan.create',{title:'出错回滚',steps:[{title:'第一步'},{title:'第二步'}]});
  const original=f.store.put.bind(f.store);let inserts=0;
  f.store.put=(kind,id,body)=>{if(kind==='agenda-item'&&++inserts===3)throw new Error('disk write fault');original(kind,id,body);};
  assert.throws(()=>f.mutate('plan.accept',{id:draft.id,revision:1}),/disk write/);f.store.put=original;
  assert.equal(f.agenda.snapshot().items.length,2);assert.equal(f.agenda.get<AgendaPlan>('plans',draft.id).status,'draft');
});

test('HTTP agenda contract, bearer protection, revision errors and persistent SSE events',async t=>{
  const service=createApp({root,dataDir:dir(),token:'agenda-test-token-abcdefghijklmnopqrstuvwxyz'});const server=service.app.listen(0,'127.0.0.1');await once(server,'listening');service.start();
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req=(path:string,method='GET',body?:unknown,key?:string)=>fetch(url+'/api/v1/agenda'+path,{method,headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await fetch(url+'/api/v1/agenda')).status,401);
  const p=await (await req('/projects','POST',{name:'旅行'},'project-key')).json();agendaResponseSchemas.AgendaProject.parse(p);
  const response=await req('/items','POST',{projectId:p.id,kind:'todo',title:'打包行李',reminderAt:'2026-01-01T00:00:00Z'},'item-key');assert.equal(response.status,201);
  const i=await response.json();agendaResponseSchemas.AgendaItem.parse(i);
  assert.equal((await req('/items/'+i.id,'PATCH',{revision:99,status:'done'})).status,409);
  service.agenda.tick();const state=await (await req('')).json();assert.equal(state.scheduler.running,true);assert.equal(state.notifications.length,1);agendaResponseSchemas.AgendaNotification.parse(state.notifications[0]);
  assert.ok(service.store.eventsAfter(0).some(e=>e.type==='agenda.reminder'));
  assert.equal((await req('/calendar?from=2026-01-01T00:00:00Z&to=2028-01-01T00:00:00Z')).status,400);
  const spec=await (await fetch(url+'/api/v1/openapi.json',{headers:{Authorization:'Bearer '+service.token}})).json();
  assert.ok(spec.paths['/api/v1/agenda/plans/{id}/accept']);
});

test('direct runtime uses agenda tools without delegation and refreshes real task state each loop',async t=>{
  const f=fixture(t);const config=new Config(f.store,root);config.update({apiKey:'fake-for-mock-only'});
  const task={id:'00000000-0000-4000-8000-000000000001',title:'已完成旧任务',status:'queued',updatedAt:'2026-10-01T00:00:00Z'} as Task;
  f.store.put('task',task.id,task);
  for(let i=0;i<12;i++)f.store.put('task',`other-${i}`,{...task,id:`other-${i}`,title:'其他任务'});
  f.store.message('assistant','已完成旧任务还在排队');f.store.message('user','记录生活项目');
  const tasks=new TaskManager(f.store,config,{async run(){throw new Error('must not delegate');}},()=>{});t.after(()=>tasks.close());
  const tools=new ButlerTools(tasks,f.store,config,f.agenda);let calls=0;
  const runtime=new DirectRuntime(config,f.store,tools,async(_url,init)=>{
    const body=JSON.parse(String(init!.body));calls++;
    if(calls===1){assert.match(body.messages[0].content,/已完成旧任务/);f.store.put('task',task.id,{...task,status:'succeeded'});return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'agenda-1',type:'function',function:{name:'manage_agenda',arguments:JSON.stringify({operation:'project.create',payload:'{"name":"生活"}'})}}]}}]});}
    assert.ok(body.messages[0].content.includes('"status":"succeeded"'));assert.ok(body.tools.some((x:any)=>x.function.name==='query_agenda'));
    return Response.json({choices:[{message:{role:'assistant',content:'已建好生活项目。'}}]});
  });
  assert.equal(await runtime.reply('记录生活项目',new AbortController().signal,()=>{}),'已建好生活项目。');
  assert.equal(f.agenda.snapshot().projects[0].name,'生活');assert.equal(f.store.tasks().length,13);
  const ctx=runtimeContext(f.store,config);assert.equal(ctx.currentTaskState.find(x=>x.id===task.id)?.status,'succeeded');
});
