import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { runZcode,parseZcodeResult,resolveZcode } from '../server/zcode';
import type { Task } from '../shared/types';

function fixture(code:string){
  mkdirSync('work',{recursive:true});const dir=mkdtempSync(resolve('work/zcode-test-'));
  const file=join(dir,'fake.mjs');writeFileSync(file,code);
  return {file,task:{executor:'zcode',instruction:'literal $(test) 中文',model:'',workspace:dir} as Task};
}
test('ZCode runner passes literal prompt, bounded permissions and parses multiline JSON',async()=>{
  const {file,task}=fixture(`const a=process.argv; if(a[a.indexOf('--mode')+1]!=='edit'||a[a.indexOf('--disallowed-tools')+1]!=='Bash')process.exit(2);console.log(JSON.stringify({sessionId:'sess_test',response:a[a.indexOf('--prompt')+1],projection:{status:'idle'}},null,2));`);
  const result=await runZcode(task,file,new AbortController().signal,()=>{});
  assert.ok(result.result.includes(task.instruction));assert.equal(result.sessionId,'sess_test');
});
test('ZCode rejects bad JSON, errors, incomplete responses, nonzero exit and unsupported models',async()=>{
  for(const value of ['bad','{}',JSON.stringify({sessionId:'s',response:'text',projection:{status:'busy'}}),JSON.stringify({sessionId:'s',response:'text',projection:{status:'idle'},permission_denials:['Write']})])assert.throws(()=>parseZcodeResult(value));
  const {file,task}=fixture(`console.log(JSON.stringify({sessionId:'s',response:'done',projection:{status:'idle'}}));process.exitCode=2;`);
  await assert.rejects(runZcode(task,file,new AbortController().signal,()=>{}),/退出码/);
  await assert.rejects(runZcode({...task,model:'unsupported'},file,new AbortController().signal,()=>{}),/模型/);
  assert.equal(resolveZcode('zcode && evil'),undefined);
});
test('ZCode cancellation and timeout abort terminate the child',async()=>{
  const {file,task}=fixture('setInterval(()=>{},1000);');
  for(const reason of ['用户取消','任务超时']){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(new Error(reason)),100);
    try{await assert.rejects(runZcode(task,file,controller.signal,()=>{}),new RegExp(reason));}finally{clearTimeout(timer);}
  }
});
