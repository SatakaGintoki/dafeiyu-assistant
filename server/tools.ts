import { z } from 'zod';
import { ApiError, Config } from './config';
import { TaskManager } from './tasks';
import type { Store } from './store';
import { runtimeStatus } from './runtime-status';
import { AgendaService } from './agenda';
import agendaDefinitions from './agenda-tool-definitions.json';

export const toolDefinitions = [
  ...agendaDefinitions,
  {name:'get_runtime_status',description:'查看当前程序版本、执行器发现结果和 Claude 完全访问设置。历史失败不代表当前不可用；发现程序不代表云端调用成功。',parameters:{type:'object',properties:{},additionalProperties:false}},
  {name:'dispatch_task',description:'用户明确要求执行工作时创建后台任务，立即返回任务 ID。纯讨论或设计咨询不创建任务。',parameters:{type:'object',properties:{title:{type:'string'},instruction:{type:'string'},executor:{type:'string',enum:['codex','claude','zcode','demo']},model:{type:'string'}},required:['title','instruction'],additionalProperties:false}},
  {name:'list_tasks',description:'查看最近任务的真实状态。',parameters:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_task_status',description:'查看指定任务的真实状态和结果。',parameters:{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false}},
  {name:'cancel_task',description:'仅在用户要求停止任务时取消指定任务。',parameters:{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false}},
  {name:'resume_task',description:'用户要求继续或重试未完成任务时使用；复用原任务 ID，Claude 优先恢复会话。fromFiles 仅在用户要求放弃旧会话、从现有文件继续时为 true。',parameters:{type:'object',properties:{taskId:{type:'string'},fromFiles:{type:'boolean'}},required:['taskId'],additionalProperties:false}},
  {name:'remember_preference',description:'保存用户明确表达的长期偏好，不保存密码或凭据。',parameters:{type:'object',properties:{key:{type:'string'},value:{type:'string'}},required:['key','value'],additionalProperties:false}},
] as const;

export class ButlerTools {
  private agenda:AgendaService;
  constructor(private tasks:TaskManager, private store:Store,private config:Config,agenda?:AgendaService){this.agenda=agenda||new AgendaService(store,()=>{});}
  async execute(name:string,args:unknown,callId?:string):Promise<unknown> {
    switch(name){
      case 'query_agenda': {
        const q=z.object({view:z.enum(['snapshot','calendar']),from:z.string().optional(),to:z.string().optional(),projectId:z.string().uuid().optional()}).strict().parse(args);
        if(q.view==='snapshot'){if(q.from||q.to||q.projectId)throw new ApiError(400,'snapshot 不接受筛选参数');return this.agenda.snapshot();}
        if(!q.from||!q.to)throw new ApiError(400,'calendar 需要 from 和 to');return this.agenda.calendar(q.from,q.to,q.projectId);
      }
      case 'manage_agenda': {
        const data=z.object({operation:z.string(),payload:z.string().max(64000)}).strict().parse(args);
        return this.agenda.mutate(data.operation,JSON.parse(data.payload),callId?`tool:${callId}`:undefined);
      }
      case 'get_runtime_status': z.object({}).strict().parse(args); return runtimeStatus(this.config);
      case 'dispatch_task': return this.tasks.create(args,callId ? `tool:${callId}` : undefined);
      case 'list_tasks': z.object({}).strict().parse(args); return this.store.tasks().slice(-20).map(({logs,...task})=>task);
      case 'get_task_status': return this.tasks.get(z.object({taskId:z.string().uuid()}).strict().parse(args).taskId);
      case 'cancel_task': return this.tasks.cancel(z.object({taskId:z.string().uuid()}).strict().parse(args).taskId);
      case 'resume_task': {
        const input=z.object({taskId:z.string().uuid(),fromFiles:z.boolean().optional()}).strict().parse(args);
        const previous=callId?this.store.get<{input:string}>('resume-request',callId):undefined;
        if(previous){if(previous.input!==JSON.stringify(input))throw new ApiError(409,'工具调用 ID 已用于其他继续请求');return this.tasks.get(input.taskId);}
        const task=this.tasks.resume(input.taskId,input.fromFiles);
        if(callId)this.store.put('resume-request',callId,{input:JSON.stringify(input)});
        return task;
      }
      case 'remember_preference': {
        const data=z.object({key:z.string().trim().min(1).max(60),value:z.string().trim().min(1).max(500)}).strict().parse(args);
        if(/key|secret|token|password|密码|密钥|令牌/i.test(data.key) || /sk-[a-zA-Z0-9_-]{12,}/.test(data.value))throw new ApiError(400,'偏好记忆不接受凭据');
        this.store.put('preference',data.key,{...data,value:this.config.redact(data.value)});return {saved:true,key:data.key};
      }
      default:throw new ApiError(400,'未知工具');
    }
  }
}
