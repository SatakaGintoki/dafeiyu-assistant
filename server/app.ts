import express, { type Request, type Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z, ZodError } from 'zod';
import { Store } from './store';
import { Config, ApiError } from './config';
import { CliRunner, executorCatalog, type Runner } from './executors';
import { TaskManager } from './tasks';
import { ButlerTools } from './tools';
import { HarnessRuntime, DirectRuntime, DemoRuntime, type Runtime } from './runtime';
import { openApiDocument } from './openapi';
import { APP_VERSION } from '../shared/version';
import { addWorkflows } from './workflows';
import { AgendaService } from './agenda';
import { addAgendaRoutes } from './agenda-routes';
import { ProjectMemories } from './project-memory';
import { addMemoryRoutes } from './memory-routes';
import { checkModelConnection } from './connection-check';

export interface AppOptions { root:string; dataDir?:string; token?:string; runner?:Runner; runtimeFactory?:(config:Config,store:Store,tools:ButlerTools)=>Runtime; origins?:string[] }
function authorized(req:Request,token:string) { const given=req.headers.authorization?.replace(/^Bearer /,'') || ''; const a=Buffer.from(given),b=Buffer.from(token);return a.length===b.length && timingSafeEqual(a,b); }

export function createApp(options:AppOptions) {
  const store=new Store(resolve(options.dataDir || join(options.root,'.data')));
  const config=new Config(store,options.root);
  const tokenFile=join(store.dir,'api-token');
  const token=options.token || process.env.DAYU_API_TOKEN || (existsSync(tokenFile)?readFileSync(tokenFile,'utf8').trim():randomBytes(32).toString('hex'));
  if(token.length<24)throw new Error('DAYU_API_TOKEN 至少需要 24 个字符');
  if(!options.token && !process.env.DAYU_API_TOKEN && !existsSync(tokenFile))writeFileSync(tokenFile,token,{mode:0o600});
  const internalToken=randomBytes(32).toString('hex');
  const clients=new Set<Response>();
  let shuttingDown=false, busy=false, petState='idle', internalUrl='', runtime:Runtime|undefined, chatController:AbortController|undefined, chatWork:Promise<void>|undefined, chatStream:{id:string;text:string}|undefined, chatProgress='';
  const derivePetState=()=>busy?'thinking':store.tasks().some(t=>['running','cancelling'].includes(t.status))?'working':store.tasks().some(t=>t.status==='queued')?'waiting':'idle';
  const publish=(type:string,data:unknown)=> {
    const event=store.event(type,data);
    for(const client of clients){if(client.writableLength>1024*1024){client.end();clients.delete(client);}else client.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);}
    return event;
  };
  const emit=(type:string,data:unknown)=>{
    const event=publish(type,data);const next=derivePetState();
    if(next!==petState){petState=next;publish('pet.state',{state:petState});}
    return event;
  };
  const tasks=new TaskManager(store,config,options.runner || new CliRunner(config),emit);
  const agenda=new AgendaService(store,emit);
  const memories=new ProjectMemories(store,emit,text=>config.redact(text));
  const tools=new ButlerTools(tasks,store,config,agenda,memories);
  const app=express(); app.disable('x-powered-by');
  const origins=new Set(options.origins || ['http://127.0.0.1:5173','http://localhost:5173']);
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    const host=req.headers.host?.split(':')[0];
    if(!['127.0.0.1','localhost'].includes(host || ''))return res.status(403).json({error:'仅允许本机访问'});
    const origin=req.headers.origin;
    if(origin){
      if(!origins.has(origin) && origin!==`http://${req.headers.host}`)return res.status(403).json({error:'不允许此来源'});
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Last-Event-ID, Idempotency-Key');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');
    }
    if(req.method==='OPTIONS')return res.sendStatus(204);
    if(shuttingDown)return res.status(503).json({error:'服务正在关闭'});
    next();
  });
  app.get('/health',(_req,res)=>res.json({ok:true,service:'dayu-backend',version:APP_VERSION}));
  app.use(['/api','/internal'],(req,res,next)=>{
    const expected=req.originalUrl.startsWith('/internal/')?internalToken:token;
    if(!authorized(req,expected))return res.status(401).json({error:'需要有效的 Bearer Token'});
    next();
  });
  app.use(express.json({limit:'128kb'}));
  addAgendaRoutes(app,agenda);
  addMemoryRoutes(app,memories);
  addWorkflows(app,store,config,tasks,()=>busy,async()=>{await runtime?.close();runtime=undefined;emit('settings.updated',config.value);});
  app.get('/api/v1/state',(_req,res)=>res.json({messages:store.messages().slice(-200),tasks:store.tasks().slice(-200),settings:config.value,executors:executorCatalog(config),busy,petState,chatStream,chatProgress}));
  app.get('/api/v1/settings',(_req,res)=>res.json(config.value));
  let checkingConnection=false;
  app.post('/api/v1/connection-check',async(req,res)=>{
    z.object({}).strict().parse(req.body||{});
    if(checkingConnection||busy)throw new ApiError(409,'请等待当前检查或对话结束');
    checkingConnection=true;
    try{res.json(await checkModelConnection(config));}finally{checkingConnection=false;}
  });
  app.get('/api/v1/openapi.json',(_req,res)=>res.json(openApiDocument));
  app.patch('/api/v1/settings',async(req,res)=>{
    if(busy || store.tasks().some(t=>['queued','running','cancelling'].includes(t.status)))throw new ApiError(409,'请等待当前对话和任务结束后修改设置');
    const settings=config.update(req.body); await runtime?.close();runtime=undefined;emit('settings.updated',settings);res.json(settings);
  });
  app.get('/api/v1/executors',(_req,res)=>res.json(executorCatalog(config)));
  app.get('/api/v1/tasks',(_req,res)=>res.json(store.tasks().slice(-200)));
  app.post('/api/v1/tasks',(req,res)=>{
    const key=req.header('Idempotency-Key');if(key && (key.length>160 || !/^[\w.:-]+$/.test(key)))throw new ApiError(400,'无效的幂等键');
    res.status(201).json(tasks.create(req.body,key ? `http:${key}` : undefined));
  });
  app.get('/api/v1/tasks/:id',(req,res)=>res.json(tasks.get(req.params.id as string)));
  app.post('/api/v1/tasks/:id/cancel',async(req,res)=>res.json(await tasks.cancel(req.params.id as string)));
  app.post('/api/v1/tasks/:id/retry',(req,res)=>res.status(201).json(tasks.retry(req.params.id as string)));
  app.post('/api/v1/tasks/:id/resume',(req,res)=>{
    const input=z.object({fromFiles:z.boolean().optional()}).strict().parse(req.body||{});
    res.json(tasks.resume(req.params.id as string,input.fromFiles));
  });
  app.post('/api/v1/tasks/:id/followup',(req,res)=>{
    const data=z.object({instruction:z.string().trim().min(1).max(8000)}).strict().parse(req.body);
    res.status(201).json(tasks.followup(req.params.id as string,data.instruction));
  });
  app.get('/api/v1/preferences',(_req,res)=>res.json(store.list('preference')));
  app.delete('/api/v1/preferences/:key',(req,res)=>{
    store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('preference',req.params.key as string);res.sendStatus(204);
  });
  app.get('/api/v1/messages',(_req,res)=>res.json(store.messages().slice(-200)));
  app.post('/api/v1/chat',(req,res)=>{
    const input=z.object({message:z.string().trim().min(1).max(12000)}).strict().parse(req.body);
    if(busy)throw new ApiError(409,'管家正在回复，请等待或取消当前回复');
    if(config.value.runtime!=='demo' && !config.apiKey)throw new ApiError(503,'尚未配置 DeepSeek API Key');
    if(config.value.runtime==='harness'&&config.value.harnessAvailable===false)throw new ApiError(503,'轻量版未包含 Harness，请下载完整版，或在设置中选择直连管家');
    busy=true;chatProgress='正在等待模型回复';chatController=new AbortController();
    const controller=chatController;
    const message=store.message('user',input.message);emit('message.created',message);emit('chat.status',{busy,petState});
    if(!runtime)runtime=options.runtimeFactory?.(config,store,tools) || (config.value.runtime==='harness'?new HarnessRuntime(config,store,()=>internalUrl,internalToken):config.value.runtime==='deepseek'?new DirectRuntime(config,store,tools):new DemoRuntime());
    const currentRuntime=runtime;chatStream={id:message.id,text:''};
    chatWork=(async()=>{
      const timer=setTimeout(()=>controller.abort(new Error('管家回复超时，请检查连接后重试')),180000);
      let lastSent=0,streamTimer:ReturnType<typeof setTimeout>|undefined;
      const flushStream=()=>{
        if(streamTimer){clearTimeout(streamTimer);streamTimer=undefined;}
        lastSent=Date.now();if(chatStream)emit('chat.stream',chatStream);
      };
      try{
        const answer=await currentRuntime.reply(input.message,controller.signal,text=>{if(text!==chatProgress){chatProgress=text;emit('chat.progress',{text});}},text=>{
          chatStream={id:message.id,text:config.redact(text)};
          if(!text){flushStream();lastSent=0;}
          else if(!lastSent||Date.now()-lastSent>=50)flushStream();
          else if(!streamTimer)streamTimer=setTimeout(flushStream,50-(Date.now()-lastSent));
        });
        controller.signal.throwIfAborted();emit('message.created',store.message('assistant',config.redact(answer)));
      }catch(error){
        const reason=controller.signal.aborted ? controller.signal.reason : error;
        const detail=config.redact(reason instanceof Error?reason.message:String(reason));
        emit('chat.error',{error:detail});emit('message.created',store.message('assistant',`这次没能完成回复：${detail}。已派出的任务可在任务列表中查看。`));
      }finally{clearTimeout(timer);if(streamTimer)clearTimeout(streamTimer);busy=false;chatStream=undefined;chatProgress='';chatController=undefined;emit('chat.status',{busy,petState:derivePetState()});}
    })();
    res.status(202).json({messageId:message.id,status:'accepted'});
  });
  app.post('/api/v1/chat/cancel',async(_req,res)=>{chatController?.abort(new Error('用户取消了本轮回复'));await runtime?.close();await chatWork;res.json({cancelled:true});});
  app.post('/internal/tool',async(req,res)=>{
    if(!busy)throw new ApiError(409,'没有进行中的管家对话');
    const input=z.object({name:z.string(),args:z.unknown(),callId:z.string().max(200).optional()}).strict().parse(req.body);
    res.json(await tools.execute(input.name,input.args,input.callId));
  });
  app.get('/api/v1/events',(req,res)=>{
    const value=req.header('Last-Event-ID') || '0';const last=Number(value);
    if(!Number.isSafeInteger(last) || last<0)throw new ApiError(400,'Last-Event-ID 必须为非负整数');
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 2000\n\n');
    const events=store.eventsAfter(last);
    for(const event of events)res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    // Clients always refresh state on connection; replay is bounded to prevent unbounded memory.
    res.write(`event: sync.required\ndata: ${JSON.stringify({type:'sync.required',data:{url:'/api/v1/state'}})}\n\n`);
    clients.add(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
    req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});
  });
  app.use((_req,res)=>res.status(404).json({error:'接口不存在'}));
  app.use((error:any,_req:Request,res:Response,_next:unknown)=>{
    const status=error instanceof ZodError?400:error instanceof ApiError?error.status:error?.type==='entity.too.large'?413:error instanceof SyntaxError?400:500;
    const message=error instanceof ZodError?'请求参数不符合接口要求：'+error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join(';'):error instanceof SyntaxError?'JSON 请求格式无效':status===500?'内部服务错误，请检查本地日志':error.message;
    res.status(status).json({error:config.redact(message)});
  });
  return {app,store,config,tasks,agenda,token,emit,start:()=>{agenda.start();tasks.pump();},setInternalUrl:(url:string)=>{internalUrl=url;},async close(){
    shuttingDown=true;agenda.close();chatController?.abort(new Error('服务关闭'));await runtime?.close();await chatWork;await tasks.close();for(const client of clients)client.end();clients.clear();store.close();
  }};
}
