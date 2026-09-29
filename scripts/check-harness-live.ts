import { createApp } from '../server/app';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';

const root=resolve('.');
const saved=join(process.env.APPDATA!, 'dayu-desktop-pet/data');
const db=new DatabaseSync(join(saved,'dayu.sqlite'),{readOnly:true});
const row=db.prepare("SELECT body FROM records WHERE kind='config' AND id='settings'").get() as {body:string}|undefined;
const settings=JSON.parse(row?.body || '{}');db.close();
const key=JSON.parse(readFileSync(join(saved,'secrets.json'),'utf8')).apiKey;
if(!key)throw new Error('No configured application key');
mkdirSync(join(root,'work'),{recursive:true});
const dataDir=mkdtempSync(join(root,'work/harness-live-'));
const service=createApp({root,dataDir});
service.config.update({apiKey:key,runtime:'harness',model:settings.model,baseUrl:settings.baseUrl,defaultExecutor:'demo'});
const server=service.app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;service.setInternalUrl(url);service.start();
const results:unknown[]=[];
try {
  for(const message of [
    '这是用户授权的联通测试。请调用 dispatch_task，executor 必须为 demo，标题为 HARNESS_LIVE_DISPATCH，instruction 为验证演示队列。只创建一次任务，不调用其他执行器。回复任务 ID。记住测试暗号 BLUE_FISH_42。',
    '不要再创建任务。请调用 list_tasks 查询刚才任务的状态，并回复上一轮的测试暗号。',
  ]) {
    const seq=service.store.eventsAfter(0).at(-1)?.seq || 0;const start=Date.now();
    const response=await fetch(url+'/api/v1/chat',{method:'POST',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},body:JSON.stringify({message})});
    if(response.status!==202)throw new Error(`Chat HTTP ${response.status}`);
    while(!service.store.eventsAfter(seq).some(e=>e.type==='chat.status' && !(e.data as any).busy)){
      if(Date.now()-start>190000)throw new Error('Live timeout');await delay(250);
    }
    const events=service.store.eventsAfter(seq);
    const result={elapsedMs:Date.now()-start,progress:events.filter(e=>e.type==='chat.progress').map(e=>e.data),errors:events.filter(e=>e.type==='chat.error').map(e=>e.data),answer:service.store.messages().at(-1)?.content};
    results.push(result);console.log(JSON.stringify(result));
    if(result.errors.length)break;
  }
  const report={results,tasks:service.store.tasks().map(t=>({id:t.id,status:t.status,title:t.title,executor:t.executor}))};
  writeFileSync(join(dataDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({tasks:report.tasks,report:join(dataDir,'report.json')}));
} finally { await service.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r())); }
