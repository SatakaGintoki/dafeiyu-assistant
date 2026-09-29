import { randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { z } from 'zod';
import type { Express } from 'express';
import { ApiError, Config, workspacePath } from './config';
import { Store } from './store';
import { TaskManager } from './tasks';
import { executorCatalog } from './executors';
import { APP_VERSION } from '../shared/version';
import type { Project, TaskTemplate } from '../shared/types';

export function addWorkflows(app:Express,store:Store,config:Config,tasks:TaskManager,busy:()=>boolean,onSettings:()=>Promise<void>){
  app.post('/api/v1/preferences/remove',(req,res)=>{const {key}=z.object({key:z.string().min(1).max(60)}).strict().parse(req.body);store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('preference',key);res.sendStatus(204);});
  app.post('/api/v1/preferences/save',(req,res)=>{
    const data=z.object({key:z.string().trim().min(1).max(60),value:z.string().trim().min(1).max(500)}).strict().parse(req.body);
    if(/key|secret|token|password|密码|密钥|令牌/i.test(data.key)||/sk-[a-zA-Z0-9_-]{12,}/.test(data.value))throw new ApiError(400,'偏好记忆不接受凭据');
    store.put('preference',data.key,{...data,value:config.redact(data.value)});res.json(data);
  });
  const projectSchema=z.object({name:z.string().trim().min(1).max(80),workspace:z.string().min(1),executor:z.enum(['codex','claude','zcode','demo']),notes:z.string().max(4000).default('')}).strict();
  app.get('/api/v1/projects',(_req,res)=>res.json(store.list<Project>('project')));
  app.post('/api/v1/projects',(req,res)=>{
    const data=projectSchema.parse(req.body);
    const project={...data,workspace:workspacePath(data.workspace),id:randomUUID()};
    if(store.list<Project>('project').some(p=>p.workspace.toLowerCase()===project.workspace.toLowerCase()))throw new ApiError(409,'此目录已保存为项目，请勿重复添加');
    store.put('project',project.id,project);res.status(201).json(project);
  });
  app.post('/api/v1/projects/:id/activate',async(req,res)=>{
    if(busy()||store.tasks().some(t=>['queued','running','cancelling'].includes(t.status)))throw new ApiError(409,'请等待当前对话和任务结束后切换项目');
    const project=store.get<Project>('project',req.params.id as string);if(!project)throw new ApiError(404,'项目不存在');
    const settings=config.update({workspace:project.workspace,defaultExecutor:project.executor});
    await onSettings();res.json(settings);
  });
  app.delete('/api/v1/projects/:id',(req,res)=>{
    if(store.tasks().some(t=>t.projectId===req.params.id&&['queued','running','cancelling'].includes(t.status)))throw new ApiError(409,'此项目还有待完成任务');
    store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('project',req.params.id as string);res.sendStatus(204);
  });
  app.get('/api/v1/templates',(_req,res)=>res.json(store.list<TaskTemplate>('template')));
  app.post('/api/v1/templates',(req,res)=>{
    const data=z.object({name:z.string().trim().min(1).max(80),instruction:z.string().trim().min(1).max(12000)}).strict().parse(req.body);
    const template={...data,id:randomUUID()};store.put('template',template.id,template);res.status(201).json(template);
  });
  app.delete('/api/v1/templates/:id',(req,res)=>{store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('template',req.params.id as string);res.sendStatus(204);});
  app.post('/api/v1/tasks/:id/recover',(req,res)=>res.json(tasks.recover(req.params.id as string)));
  app.post('/api/v1/tasks/:id/reveal',(req,res)=>{
    const {index}=z.object({index:z.number().int().min(-1).max(10000)}).strict().parse(req.body);
    try{res.json({path:tasks.checkpoints.reveal(tasks.get(req.params.id as string),index)});}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(404,'项目或产物已移动、删除，无法定位');}
  });
  app.get('/api/v1/diagnostics',(_req,res)=>{
    let writable=true;try{accessSync(config.value.workspace,constants.R_OK|constants.W_OK);}catch{writable=false;}
    const settings=config.value;
    res.json({version:APP_VERSION,checks:[
      {name:'本地后端',ok:true,detail:'已连接，数据库可读写'},
      {name:'管家模型配置',ok:settings.runtime==='demo'||settings.hasApiKey,detail:settings.runtime==='demo'?'当前是演示模式，不调用真实模型':settings.hasApiKey?'密钥已配置；尚未检查云端连通或额度':'请填写 DeepSeek API Key 并保存'},
      {name:'工作目录',ok:writable,detail:writable?settings.workspace:'目录不存在或没有读写权限，请重新选择'},
      ...executorCatalog(config).filter(e=>e.id!=='demo').map(e=>({name:e.name,ok:e.available,detail:e.detail})),
    ]});
  });
}
