import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app';

test('first-run journey without credentials: configure demo, finish task, restart and recover history',async()=>{
  mkdirSync(resolve('work'),{recursive:true});
  const root=mkdtempSync(join(resolve('work'),'first-run-'));
  const dataDir=join(root,'data');
  let service=createApp({root,dataDir});
  service.config.update({apiKey:''});
  let server=service.app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  const address=server.address() as {port:number};
  const url=`http://127.0.0.1:${address.port}`;
  const request=(path:string,method='GET',body?:unknown)=>fetch(url+'/api/v1'+path,{method,headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    assert.equal((await request('/chat','POST',{message:'hi'})).status,503);
    const configured=await request('/settings','PATCH',{runtime:'demo',defaultExecutor:'demo'});
    assert.equal(configured.status,200);
    assert.equal((await request('/chat','POST',{message:'你好'})).status,202);
    const response=await request('/tasks','POST',{title:'首次体验',instruction:'验证队列',executor:'demo'});
    assert.equal(response.status,201);const task=await response.json();
    const deadline=Date.now()+10000;
    while(service.tasks.get(task.id).status!=='succeeded'){
      if(Date.now()>deadline)throw new Error('First-run demo timed out');await delay(30);
    }
    const token=service.token;
    await service.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
    service=createApp({root,dataDir});
    assert.equal(service.token,token);
    assert.equal(service.config.value.runtime,'demo');
    assert.equal(service.tasks.get(task.id).status,'succeeded');
    assert.ok(service.store.messages().some(m=>m.content.includes('离线演示')));
    assert.equal(service.store.tasks().length,1,'restart must not create another task');
  }finally{
    await service.close();server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));
  }
});
