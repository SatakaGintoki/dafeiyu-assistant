import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { DirectRuntime, HarnessRuntime } from '../server/runtime';

// Explicit live evaluation: only synthetic dialogue is sent to the configured model.
const root=resolve('.');
const saved=join(process.env.APPDATA!,'dayu-desktop-pet/data');
const db=new DatabaseSync(join(saved,'dayu.sqlite'),{readOnly:true});
const row=db.prepare("SELECT body FROM records WHERE kind='config' AND id='settings'").get() as {body:string}|undefined;
const settings=JSON.parse(row?.body || '{}');db.close();
const key=JSON.parse(readFileSync(join(saved,'secrets.json'),'utf8')).apiKey;
if(!key)throw new Error('No configured application key');
mkdirSync(join(root,'work'),{recursive:true});
const dir=mkdtempSync(join(root,'work/conversation-live-'));
const previousKey=process.env.DEEPSEEK_API_KEY;
process.env.DEEPSEEK_API_KEY=key;
const service=createApp({root,dataDir:dir});
if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey;
service.config.update({model:settings.model,baseUrl:settings.baseUrl,defaultExecutor:'demo'});
const server=service.app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
service.setInternalUrl(url);
const harness=new HarnessRuntime(service.config,service.store,()=>url,service.token);
const direct=new DirectRuntime(service.config,service.store,{execute:async()=>{throw new Error('No tools in dialogue evaluation');}} as any);
const results:unknown[]=[];
try {
  for(const [runtime,input] of [
    [harness,'你好啊'],
    [harness,'你这条吃白饭的大肥鱼，又在摸鱼？'],
    [harness,'前后端分离是什么意思？只说重点。'],
    [harness,'今天有点烦，做什么都不顺。'],
    [direct,'我不懂 Git，先告诉我它有什么用，简单点。'],
  ] as const){
    service.store.message('user',input);
    const answer=await runtime.reply(input,AbortSignal.timeout(120000),()=>{});
    service.store.message('assistant',answer);
    const result={runtime:runtime===harness?'harness':'direct',input,answer,characters:Array.from(answer).length};
    results.push(result);console.log(JSON.stringify(result));
  }
  writeFileSync(join(dir,'report.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({report:join(dir,'report.json')}));
} finally {
  await harness.close();await direct.close();await service.close();
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
}
