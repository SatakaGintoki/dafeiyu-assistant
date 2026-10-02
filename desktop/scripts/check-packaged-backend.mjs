// Test the staged/packaged backend, not the source dependency tree. Models are local mocks.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const resources=resolve(process.argv[2]||'desktop/package-resources');
const profile=JSON.parse(readFileSync(join(resources,'build-profile.json'),'utf8')).profile;
assert.ok(['lite','full'].includes(profile));
const sdk=join(resources,'backend/node_modules/@deepseek-ai/dsh-sdk-client/package.json');
assert.equal(existsSync(sdk),profile==='full');
assert.equal(existsSync(join(resources,'backend/node_modules/@deepseek-ai/libreoffice-kit-win32-x64')),false);
assert.ok(existsSync(join(resources,'backend/LICENSE')));
const data=mkdtempSync(join(resolve('work'),'package-backend-check-'));
const env={...process.env,DAYU_USER_DATA:data};
for(const k of ['DAYU_API_TOKEN','DAYU_DATA_DIR','DAYU_BACKEND_URL','ELECTRON_RUN_AS_NODE','DEEPSEEK_API_KEY'])delete env[k];
const child=spawn(join(resources,'runtime/node.exe'),[join(resources,'backend/server/index.mjs')],{cwd:data,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
let projectId;let modelCalls=0;
const model=createServer(async(req,res)=>{
 let text='';for await(const c of req)text+=c;const b=JSON.parse(text);modelCalls++;
 const toolResult=b.messages.some(m=>m.role==='tool'||Array.isArray(m.content)&&m.content.some(c=>c.type==='tool_result'));
 const args={projectId};
 if(req.url.endsWith('/chat/completions')){
   assert.ok(b.tools.some(t=>t.function.name==='query_project_memory'));
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:toolResult?{content:'已读取项目记忆。'}:{tool_calls:[{id:'memory_direct',type:'function',function:{name:'query_project_memory',arguments:JSON.stringify(args)}}]}}]}));return;
 }
 assert.ok(b.tools.some(t=>t.name==='query_project_memory'));
 assert.ok(!b.tools.some(t=>t.name==='bash'||t.name==='pwsh'));
 res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
 send('message_start',{type:'message_start',message:{id:'mock',type:'message',role:'assistant',content:[],model:'deepseek-flash',stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
 send('content_block_start',{type:'content_block_start',index:0,content_block:toolResult?{type:'text',text:''}:{type:'tool_use',id:'memory_harness',name:'query_project_memory',input:{}}});
 send('content_block_delta',{type:'content_block_delta',index:0,delta:toolResult?{type:'text_delta',text:'已读取项目记忆。'}:{type:'input_json_delta',partial_json:JSON.stringify(args)}});
 send('content_block_stop',{type:'content_block_stop',index:0});send('message_delta',{type:'message_delta',delta:{stop_reason:toolResult?'end_turn':'tool_use',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{type:'message_stop'});res.end();
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let url;
try {
 url=await new Promise((resolveReady,reject)=>{const timer=setTimeout(()=>reject(new Error('Backend ready timeout: '+stderr)),15000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolveReady(m.url);}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Backend exit '+code+': '+stderr));});});
 const token=readFileSync(join(data,'data/api-token'),'utf8').trim();
 const call=async(path,method='GET',body)=>{const response=await fetch(url+'/api/v1'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};};
 assert.equal((await call('/settings')).body.harnessAvailable,profile==='full');
 projectId=(await call('/agenda/projects','POST',{name:'包体验证项目'})).body.id;
 const memory=await call('/project-memories','POST',{projectId,kind:'next',content:'补删除边界测试'});assert.equal(memory.status,201);
 assert.equal((await call('/project-memories?projectId='+projectId)).body[0].content,'补删除边界测试');
 model.listen(0,'127.0.0.1');await once(model,'listening');const baseUrl=`http://127.0.0.1:${model.address().port}`;
 async function chat(runtime){assert.equal((await call('/settings','PATCH',{apiKey:'isolated-package-mock',baseUrl,runtime})).status,200);assert.equal((await call('/chat','POST',{message:'继续包体验证项目，下一步是什么？'})).status,202);let state;for(let i=0;i<300;i++){state=(await call('/state')).body;if(!state.busy)break;await pause(100);}assert.equal(state.busy,false);assert.equal(state.messages.at(-1).content,'已读取项目记忆。');}
 await chat('deepseek');
 if(profile==='full')await chat('harness');else {assert.equal((await call('/settings','PATCH',{runtime:'harness'})).status,503);assert.equal((await call('/settings')).body.runtime,'deepseek');}
 assert.equal(modelCalls,profile==='full'?4:2);
 assert.equal((await call('/settings','PATCH',{runtime:'demo',defaultExecutor:'demo'})).status,200);
 const created=await call('/tasks','POST',{title:'包体验证',instruction:'demo',executor:'demo'});assert.equal(created.status,201);
 let task;for(let i=0;i<50;i++){task=(await call('/tasks/'+created.body.id)).body;if(task.status==='succeeded')break;await pause(100);}assert.equal(task.status,'succeeded');
 console.log(`PASS: ${profile} staged backend, memory, Direct tool loop, ${profile==='full'?'real Harness SDK with mock model':'missing Harness handled explicitly'}, demo task; no real model or executor used.`);
}finally{model.closeAllConnections();model.close();if(child.exitCode===null){const exit=once(child,'exit');if(child.connected)child.send('shutdown');else child.kill();const timer=setTimeout(()=>child.kill(),15000);await exit;clearTimeout(timer);}}
