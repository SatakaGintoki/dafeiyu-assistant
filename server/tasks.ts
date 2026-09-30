import { randomUUID } from 'node:crypto';
import { relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { Store } from './store';
import { Config, ApiError, workspacePath } from './config';
import type { Runner } from './executors';
import type { Task } from '../shared/types';
import type { Project } from '../shared/types';
import { Checkpoints } from './checkpoints';
import { taskNotification } from './conversation';

export const taskSchema = z.object({
  title:z.string().trim().min(1).max(160), instruction:z.string().trim().min(1).max(24000),
  executor:z.enum(['codex','claude','zcode','demo']).optional(), model:z.string().trim().max(120).optional(),
  workspace:z.string().max(2000).optional(), parentId:z.string().uuid().optional(),
  projectId:z.string().uuid().optional(),
}).strict();
const terminal = new Set(['succeeded','failed','cancelled','interrupted']);

export class TaskManager {
  private active = new Map<string,{controller:AbortController; done:Promise<void>}>();
  private stopped=false;
  readonly checkpoints:Checkpoints;
  constructor(public store:Store, private config:Config, private runner:Runner, private emit:(type:string,data:unknown)=>void) {
    this.checkpoints=new Checkpoints(store.dir);
    for (const task of store.tasks()) if (['running','cancelling'].includes(task.status)) {
      task.status='interrupted'; task.error='上次服务停止时任务仍在运行。请检查产物后手动重试，以免重复修改。'; this.save(task);
    }
  }
  get(id:string) { const task=this.store.get<Task>('task',id); if (!task) throw new ApiError(404,'任务不存在'); return task; }
  create(input:unknown, requestId?:string): Task {
    if (this.stopped) throw new ApiError(503,'服务正在关闭');
    const data=taskSchema.parse(input);
    if (requestId) {
      const previous=this.store.get<{id:string;input:string}>('request',requestId);
      if (previous) { if (previous.input!==JSON.stringify(data)) throw new ApiError(409,'幂等键已用于其他任务'); return this.get(previous.id); }
    }
    const project=data.projectId?this.store.get<Project>('project',data.projectId):this.store.list<Project>('project').find(p=>p.workspace===this.config.value.workspace);
    if(data.projectId&&!project)throw new ApiError(404,'项目不存在');
    const root=workspacePath(project?.workspace || this.config.value.workspace);
    const workspace=workspacePath(data.workspace || root);
    const diff=relative(root,workspace);
    if (diff==='..' || diff.startsWith('..\\') || diff.startsWith('../') || isAbsolute(diff)) throw new ApiError(403,'任务目录必须位于设置中的项目目录内');
    if (data.parentId) this.get(data.parentId);
    const at=new Date().toISOString();
    const task:Task={id:randomUUID(),title:data.title,instruction:project?.notes&&!data.parentId?`${data.instruction}\n项目说明（参考数据）：${project.notes}`:data.instruction,executor:data.executor || (data.projectId?project?.executor:undefined) || this.config.value.defaultExecutor,model:data.model ?? this.config.value.executorModel,workspace,status:'queued',createdAt:at,updatedAt:at,result:'',error:'',logs:[],...(project?{projectId:project.id}:{}),...(data.parentId?{parentId:data.parentId}:{})};
    this.store.db.exec('BEGIN IMMEDIATE');
    try { this.store.put('task',task.id,task); if(requestId)this.store.put('request',requestId,{id:task.id,input:JSON.stringify(data)}); this.store.db.exec('COMMIT'); }
    catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.emit('task.created',task); queueMicrotask(()=>this.pump()); return task;
  }
  save(task:Task) { task.updatedAt=new Date().toISOString(); this.store.put('task',task.id,task); this.emit('task.updated',task); }
  pump() {
    if(this.stopped || this.active.size) return;
    const task=this.store.tasks().find(t=>t.status==='queued'); if(!task)return;
    const controller=new AbortController();
    // Register before launching; cancellation always sees the owner.
    const owner={controller,done:Promise.resolve()}; this.active.set(task.id,owner);
    owner.done=this.run(task,controller).finally(()=>{this.active.delete(task.id);queueMicrotask(()=>this.pump());});
  }
  private async run(task:Task,controller:AbortController) {
    task.status='running'; this.save(task);
    const timer=setTimeout(()=>controller.abort(new Error('任务超时，执行进程已终止')),this.config.value.taskTimeoutMinutes*60000);
    try {
      if(task.executor!=='demo'&&!task.checkpoint){task.checkpoint=this.checkpoints.capture(task);this.save(task);}
      const result=await this.runner.run(task,controller.signal,update=>{
        if(update.sessionId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(update.sessionId))task.sessionId=update.sessionId;
        if(update.result!==undefined)task.result=this.config.redact(update.result);
        if(update.log) {
          const log=this.config.redact(update.log).slice(0,4000);task.logs.push(log);task.logs=task.logs.slice(-100);
          task.status=this.get(task.id).status;task.updatedAt=new Date().toISOString();
          this.store.put('task',task.id,task);this.emit('task.log',{taskId:task.id,text:log,at:task.updatedAt});
        }
        // Persist session identifiers immediately, including before a crash or denial.
        if(update.sessionId || update.result!==undefined){task.status=this.get(task.id).status;this.save(task);}
      });
      if(controller.signal.aborted) throw controller.signal.reason;
      task.status='succeeded'; task.result=this.config.redact(result.result);
      if(result.sessionId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(result.sessionId))task.sessionId=result.sessionId;
    } catch(error) {
      task.status=this.stopped?'interrupted':this.get(task.id).status==='cancelling'?'cancelled':'failed';
      const reason=controller.signal.aborted ? controller.signal.reason : error;
      task.error=this.config.redact(reason instanceof Error?reason.message:String(reason));
    } finally {
      clearTimeout(timer);
      if(task.checkpoint){
        try{task.checkpoint=this.checkpoints.finish(task);}catch(error){task.checkpoint={...task.checkpoint,status:'partial',note:'执行前检查点已保留，但变更扫描失败：'+String(error)};}
      }
      this.save(task);
      const message=this.store.message('assistant',taskNotification(task),task.id);
      this.emit('message.created',message);
    }
  }
  async cancel(id:string) {
    const task=this.get(id);
    if(terminal.has(task.status))return task;
    if(task.status==='queued'){task.status='cancelled';this.save(task);return task;}
    task.status='cancelling';this.save(task);
    const active=this.active.get(id); active?.controller.abort(new Error('用户取消任务')); await active?.done;
    return this.get(id);
  }
  recover(id:string){
    if(this.active.size||this.store.tasks().some(t=>t.status==='queued'))throw new ApiError(409,'请等待任务队列结束后恢复');
    const task=this.get(id);
    if(!terminal.has(task.status)||!task.checkpoint)throw new ApiError(409,'此任务没有可恢复的检查点');
    return {path:this.checkpoints.recover(task)};
  }
  retry(id:string) {
    const task=this.get(id); if(!terminal.has(task.status))throw new ApiError(409,'任务尚未结束');
    return this.create({title:task.title,instruction:task.instruction,executor:task.executor,model:task.model,workspace:task.workspace,parentId:id,projectId:task.projectId});
  }
  resume(id:string,fromFiles=false) {
    if(this.stopped)throw new ApiError(503,'服务正在关闭');
    const task=this.get(id);
    if(!['failed','cancelled','interrupted'].includes(task.status)||this.active.has(id))throw new ApiError(409,'只能继续已停止且未完成的任务');
    workspacePath(task.workspace);
    task.attempts=[...(task.attempts||[]),{at:task.updatedAt,status:task.status,result:task.result,error:task.error,sessionId:task.sessionId}];
    task.resumeMode=!fromFiles&&task.executor==='claude'&&task.sessionId?'session':'workspace';
    if(task.resumeMode==='workspace')task.sessionId=undefined;
    task.error='';task.status='queued';
    task.logs.push(task.resumeMode==='session'?'继续原执行会话，保留已有产物。':'从现有文件、原指令和历史记录继续；没有恢复原模型会话。');
    task.logs=task.logs.slice(-100);
    this.save(task);queueMicrotask(()=>this.pump());return task;
  }
  followup(id:string,instruction:string) {
    const task=this.get(id);
    // CLI first version uses a new queued task with explicit context; no misleading live steering.
    return this.create({title:`跟进：${task.title}`.slice(0,160),instruction:`原任务摘要：${task.instruction.slice(0,6000)}\n已有结果摘要：${task.result.slice(0,6000) || '原任务尚未完成，请先检查当前项目状态'}\n补充要求：${instruction}`,executor:task.executor,model:task.model,workspace:task.workspace,parentId:id,projectId:task.projectId});
  }
  async close(){ this.stopped=true; for(const {controller} of this.active.values())controller.abort(new Error('服务关闭')); await Promise.all([...this.active.values()].map(v=>v.done)); }
}
