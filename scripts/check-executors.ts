import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../server/store';
import { Config } from '../server/config';
import { CliRunner, resolveExecutor } from '../server/executors';
import type { Task } from '../shared/types';

const root=resolve('.');mkdirSync(join(root,'work'),{recursive:true});
const dir=mkdtempSync(join(root,'work/live-executors-'));
const store=new Store(dir),config=new Config(store,root),runner=new CliRunner(config);
try {
  for(const executor of ['claude','codex'] as const) {
    if(!resolveExecutor(executor)){console.log(`${executor}: NOT INSTALLED`);continue;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Live smoke timeout')),90000);
    try {
      const result=await runner.run({id:'smoke',title:'Connectivity check',instruction:'这是一次最小联通测试。不要使用任何工具，不读写文件，不运行命令。只回复 DAYU_EXECUTOR_OK。',executor,workspace:dir,model:''} as Task,controller.signal,update=>{if(update.error || update.log)console.log(`${executor}: ${config.redact(update.error || update.log || '').slice(0,1200)}`);});
      if(!result.result.includes('DAYU_EXECUTOR_OK'))throw new Error('Unexpected reply');
      console.log(`${executor}: PASS (real authenticated model response)`);
    }catch(error){console.log(`${executor}: FAIL — ${config.redact(error instanceof Error?error.message:String(error))}`);process.exitCode=1;}
    finally {clearTimeout(timer);}
  }
}finally {store.close();}
