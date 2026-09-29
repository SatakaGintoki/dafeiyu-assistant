import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, isAbsolute, extname, basename } from 'node:path';
import type { Task } from '../shared/types';
import type { ExecutionUpdate } from './executor-events';
import { killTree } from './executors';

export function resolveZcode(configured='') {
  const candidates:string[]=[];
  if(configured){if(!isAbsolute(configured))return; candidates.push(configured);}
  else {
    if(process.env.ZCODE_PATH)candidates.push(process.env.ZCODE_PATH);
    const home=process.env.USERPROFILE || process.env.HOME || '';
    candidates.push(join(home,'AppData/Local/Programs/ZCode/ZCode.exe'),'D:/Zcode/ZCode.exe');
    if(process.platform==='win32'){
      try {
        const output=execFileSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','/s','/f','ZCode','/d'],{encoding:'utf8',windowsHide:true,timeout:3000,stdio:['ignore','pipe','ignore']});
        for(const line of output.split(/\r?\n/)){
          const match=line.match(/DisplayIcon\s+REG_SZ\s+(.+)/i);
          if(match)candidates.push(join(dirname(match[1].trim().replace(/^"|"$/g,'')),'ZCode.exe'));
        }
      }catch{}
    }
  }
  for(let candidate of candidates){
    if(!isAbsolute(candidate) || !existsSync(candidate))continue;
    if(basename(candidate).toLowerCase()==='zcode.exe')candidate=join(dirname(candidate),'resources/glm/zcode.cjs');
    if(!existsSync(candidate) || !['.cjs','.mjs','.js'].includes(extname(candidate)))continue;
    return {command:process.execPath,prefix:[candidate]};
  }
}

export function parseZcodeResult(text:string) {
  let result:any;
  try{result=JSON.parse(text);}catch{throw new Error('ZCode 没有返回有效 JSON 结果');}
  if(result.error || result.is_error || result.permission_denials?.length || result.projection?.status!=='idle' || typeof result.response!=='string' || !result.response.trim() || typeof result.sessionId!=='string')
    throw new Error('ZCode 返回失败、权限拒绝或不完整结果，请检查 ZCode 登录和权限设置');
  return {result:result.response,sessionId:result.sessionId};
}

export async function runZcode(task:Task,path:string,signal:AbortSignal,onUpdate:(item:ExecutionUpdate)=>void){
  if(task.model)throw new Error('ZCode 使用自身配置的模型，请清空本任务的模型字段（及设置中的执行器模型）');
  const executable=resolveZcode(path);
  if(!executable)throw new Error('未找到 ZCode，请在设置中填写 ZCode.exe 或 zcode.cjs 的绝对路径');
  signal.throwIfAborted();
  const env={...process.env};
  for(const key of ['DEEPSEEK_API_KEY','DAYU_API_TOKEN','DAYU_INTERNAL_TOKEN','DAYU_INTERNAL_URL'])delete env[key];
  const builtin=join(dirname(executable.prefix[0]),'../config/provider/zcode-builtin.json');
  if(existsSync(builtin)){
    env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=builtin;
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=join(process.env.USERPROFILE || process.env.HOME || '', '.zcode/v2/provider_config.json');
  }
  const prompt=`用户任务：\n${task.instruction}\n工作要求：只在当前目录内工作。不要发布、推送、联系他人或绕过权限。完成后说明修改和实际验证结果，不能验证时明确说明。`;
  return new Promise<{result:string;sessionId:string}>((resolve,reject)=>{
    const child=spawn(executable.command,[...executable.prefix,'--cwd',task.workspace,'--mode','edit','--disallowed-tools','Bash','--json','--no-color','--prompt',prompt],{cwd:task.workspace,env,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    let output:Buffer[]=[];let bytes=0;let stderr='';let overflow=false;
    onUpdate({log:'ZCode 已启动：允许文件编辑，禁用 Bash。当前 CLI 在结束时返回结果，执行期间等待中。'});
    const abort=()=>{void killTree(child);};
    signal.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024){overflow=true;void killTree(child);}else output.push(chunk);});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',(text:string)=>{stderr=(stderr+text).slice(-8000);onUpdate({log:text.slice(0,2000)});});
    child.once('error',error=>{signal.removeEventListener('abort',abort);reject(error);});
    child.once('close',code=>{
      signal.removeEventListener('abort',abort);
      if(signal.aborted)return reject(signal.reason || new Error('ZCode 任务已取消'));
      if(overflow)return reject(new Error('ZCode 结果超过 2 MB，执行已停止'));
      if(code!==0)return reject(new Error(stderr || `ZCode 退出码 ${code}`));
      try{const result=parseZcodeResult(Buffer.concat(output).toString('utf8'));onUpdate({completed:true,...result});resolve(result);}catch(error){reject(error);}
    });
    if(signal.aborted)abort();
  });
}
