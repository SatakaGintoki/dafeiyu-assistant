import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';

test('real Harness runtime calls our plugin through HTTP and finishes a durable task (mock model only)',{timeout:60000},async t=>{
  const root=resolve('.');mkdirSync(join(root,'work'),{recursive:true});const dataDir=mkdtempSync(join(root,'work/harness-e2e-'));
  let modelCalls=0;let toolNames:string[]=[];let sawToolResult=false;
  const requests:any[]=[];
  let hang=false;
  let empty=false;
  const model=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const body=JSON.parse(text);modelCalls++;toolNames=(body.tools || []).map((tool:any)=>tool.name);
    requests.push(body);
    if(hang)return;
    if(modelCalls>1)sawToolResult=body.messages.some((m:any)=>m.content?.some?.((b:any)=>b.type==='tool_result'));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(type:string,data:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    send('message_start',{type:'message_start',message:{id:`msg_${modelCalls}`,type:'message',role:'assistant',content:[],model:'deepseek-flash',stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
    if(modelCalls===1){
      send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool_live_1',name:'dispatch_task',input:{}}});
      send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({title:'Harness 集成测试',instruction:'Only demo',executor:'demo'})}});
    }else{
      send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}});
      send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:empty?'':'任务已经排队，我会告诉你结果。'}});
    }
    send('content_block_stop',{type:'content_block_stop',index:0});
    send('message_delta',{type:'message_delta',delta:{stop_reason:modelCalls===1?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:15}});
    send('message_stop',{type:'message_stop'});res.end();
  });
  model.listen(0,'127.0.0.1');await once(model,'listening');
  const service=createApp({root,dataDir,token:'harness-test-abcdefghijklmnopqrstuvwxyz'});
  const server=service.app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;service.setInternalUrl(url);
  t.after(async()=>{await service.close();server.closeAllConnections();model.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>model.close(()=>r()))]);});
  service.config.update({apiKey:'test-key-not-real',model:'deepseek-flash',baseUrl:`http://127.0.0.1:${(model.address() as AddressInfo).port}`,runtime:'harness'});
  const response=await fetch(url+'/api/v1/chat',{method:'POST',headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json'},body:JSON.stringify({message:'创建一个演示任务'})});
  assert.equal(response.status,202);
  const start=Date.now();while(!service.store.eventsAfter(0).some(e=>e.type==='chat.status' && (e.data as any).busy===false)){if(Date.now()-start>45000)throw new Error('Harness test timed out');await delay(100);}
  const errors=service.store.eventsAfter(0).filter(e=>e.type==='chat.error');assert.deepEqual(errors,[]);
  assert.equal(modelCalls,2);assert.equal(sawToolResult,true);
  assert.ok(JSON.stringify(requests[0].system).includes('蓝色大肥鱼'), 'the actual model request must include the persona');
  assert.ok(JSON.stringify(requests[0].system).includes('默认只返回重点'), 'Harness must receive the same short chat style as direct mode');
  assert.deepEqual(toolNames.sort(),['get_runtime_status','dispatch_task','list_tasks','get_task_status','cancel_task','remember_preference'].sort());
  assert.ok(JSON.stringify(requests[0].messages).includes('currentRuntime'));
  assert.equal(service.store.tasks().length,1);
  assert.ok(service.store.messages().some(m=>m.content==='任务已经排队，我会告诉你结果。'));
  while(service.store.tasks()[0].status!=='succeeded'){if(Date.now()-start>50000)throw new Error('Task timeout');await delay(50);}
  assert.match(service.store.tasks()[0].result,/演示流程完成/);
  async function chat(message:string,expectError=false){
    const before=service.store.eventsAfter(0).at(-1)?.seq || 0;
    const response=await fetch(url+'/api/v1/chat',{method:'POST',headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json'},body:JSON.stringify({message})});
    assert.equal(response.status,202);
    const until=Date.now()+15000;
    while(!service.store.eventsAfter(before).some(e=>e.type==='chat.status' && !(e.data as any).busy)){
      if(Date.now()>until)throw new Error('Followup timeout');await delay(30);
    }
    const errors=service.store.eventsAfter(before).filter(e=>e.type==='chat.error');
    if(expectError)assert.equal(errors.length,1);else assert.deepEqual(errors,[]);
    return service.store.eventsAfter(before);
  }
  const followup=await chat('第二轮：记住刚才的任务');
  assert.ok(!followup.some(e=>e.type==='chat.progress' && (e.data as any).text.includes('初始化')));
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('创建一个演示任务'));
  const lastUser=requests.at(-1).messages.filter((m:any)=>m.role==='user').at(-1);
  assert.ok(JSON.stringify(lastUser).includes('第二轮：记住刚才的任务'));
  assert.ok(!JSON.stringify(lastUser).includes('conversation'));
  hang=true;
  const callsBefore=modelCalls;
  await fetch(url+'/api/v1/chat',{method:'POST',headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json'},body:JSON.stringify({message:'取消这个等待中的请求'})});
  const cancelDeadline=Date.now()+10000;
  while(modelCalls===callsBefore){if(Date.now()>cancelDeadline)throw new Error('Model did not receive pending turn');await delay(20);}
  const cancelled=await fetch(url+'/api/v1/chat/cancel',{method:'POST',headers:{Authorization:'Bearer '+service.token},signal:AbortSignal.timeout(10000)});
  assert.equal(cancelled.status,200);
  hang=false;
  const recovered=await chat('取消后恢复');
  assert.ok(recovered.some(e=>e.type==='chat.progress' && (e.data as any).text.includes('初始化')));
  for(let i=0;i<24;i++)await chat(`会话边界验证 ${i}`);
  const finalUser=requests.at(-1).messages.filter((m:any)=>m.role==='user').at(-1);
  assert.ok(JSON.stringify(finalUser).includes('conversation'), '25th turn boots a bounded fresh session');
  assert.equal(requests.at(-1).messages.length,1, 'fresh session does not keep the entire old transcript');
  empty=true;
  await chat('空回复错误',true);
  empty=false;
  const afterError=await chat('错误后恢复');
  assert.ok(afterError.some(e=>e.type==='chat.progress' && (e.data as any).text.includes('初始化')));
});
