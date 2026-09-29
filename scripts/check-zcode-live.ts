import { createApp } from '../server/app';
import { mkdirSync,mkdtempSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

mkdirSync('work',{recursive:true});const dir=mkdtempSync(resolve('work/zcode-queue-live-'));
const service=createApp({root:dir,dataDir:join(dir,'data')});
service.config.update({defaultExecutor:'zcode',workspace:join(dir,'projects')});
try{
  const task=service.tasks.create({title:'ZCode 真实写文件验收',executor:'zcode',instruction:'这是用户授权的文件编辑测试。只在当前目录创建 zcode-result.txt，内容严格为 ZCODE_QUEUE_OK 42。不要运行命令，不要访问其他目录。完成后确认文件内容。'});
  const deadline=Date.now()+90000;
  while(['queued','running','cancelling'].includes(service.tasks.get(task.id).status)){
    if(Date.now()>deadline){await service.tasks.cancel(task.id);throw new Error('ZCode live timeout');}await delay(200);
  }
  const result=service.tasks.get(task.id);
  console.log(JSON.stringify({status:result.status,error:result.error,result:result.result,workspace:result.workspace}));
  if(result.status!=='succeeded')throw new Error('ZCode task failed');
  if(readFileSync(join(result.workspace,'zcode-result.txt'),'utf8').trim()!=='ZCODE_QUEUE_OK 42')throw new Error('Artifact check failed');
  console.log('PASS: ZCode queue and independent file verification');
}finally{await service.close();}
