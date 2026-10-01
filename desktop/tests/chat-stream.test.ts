import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/lib/store';
import { activity, permissionBlocked } from '../src/lib/activity';
import type { StreamItem, Task } from '../src/lib/types';

test('stream snapshots reconnect, completion replaces the draft, replay cannot duplicate final messages',async()=>{
  let receive!:(item:StreamItem)=>void;
  let snapshot:any={messages:[],tasks:[],executors:[],busy:true,petState:'thinking',chatStream:{id:'turn',text:'已生成前半句'},chatProgress:'正在回复'};
  const store=new Store({subscribe(cb){receive=cb;return()=>{};},connection:async()=> 'offline',request:async()=>({status:200,body:snapshot})});
  await store.sync();assert.equal(store.get().streamText,'已生成前半句');
  const event=(seq:number,type:string,data:unknown)=>receive({kind:'event',event:{seq,type,data,at:''}});
  event(1,'chat.stream',{id:'turn',text:'完整回复'});assert.equal(store.get().streamText,'完整回复');
  const message={id:'final',role:'assistant',content:'完整回复',createdAt:''};
  event(2,'message.created',message);assert.equal(store.get().streamText,'');
  event(3,'chat.status',{busy:false});event(4,'chat.stream',{id:'turn',text:'过期片段'});
  assert.equal(store.get().streamText,'');assert.equal(store.get().messages.length,1);
  event(2,'message.created',message);assert.equal(store.get().messages.length,1);
  snapshot={...snapshot,messages:[message],busy:false,chatStream:undefined};await store.sync();assert.equal(store.get().streamText,'');
});
test('activity separates model reply, execution, queue and actual permission failures',()=>{
  const task={id:'a',status:'failed',updatedAt:new Date().toISOString(),error:'Claude Code permission denied for: Bash'} as Task;
  assert.equal(permissionBlocked(task),true);
  assert.equal(permissionBlocked({...task,status:'succeeded'}),false);
  assert.equal(permissionBlocked({...task,error:'connection timeout'}),false);
  assert.equal(activity([task],true,'正在回复').text,'正在回复');
  assert.match(activity([{...task,status:'running'}],false,'').text,/执行器正在工作/);
  assert.match(activity([{...task,status:'queued'}],false,'').text,/等待执行/);
  assert.equal(activity([task],false,'').taskId,'a');
  assert.equal(activity([{...task,updatedAt:'2020-01-01T00:00:00Z'}],false,'').dot,'on');
});
