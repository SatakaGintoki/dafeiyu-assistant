import { z } from 'zod';
import { ApiError, Config } from './config';
import { TaskManager } from './tasks';
import type { Store } from './store';

export const toolDefinitions = [
  {name:'dispatch_task',description:'用户明确要求执行工作时创建后台任务，立即返回任务 ID。纯讨论或设计咨询不创建任务。',parameters:{type:'object',properties:{title:{type:'string'},instruction:{type:'string'},executor:{type:'string',enum:['codex','claude','zcode','demo']},model:{type:'string'}},required:['title','instruction'],additionalProperties:false}},
  {name:'list_tasks',description:'查看最近任务的真实状态。',parameters:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_task_status',description:'查看指定任务的真实状态和结果。',parameters:{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false}},
  {name:'cancel_task',description:'仅在用户要求停止任务时取消指定任务。',parameters:{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false}},
  {name:'remember_preference',description:'保存用户明确表达的长期偏好，不保存密码或凭据。',parameters:{type:'object',properties:{key:{type:'string'},value:{type:'string'}},required:['key','value'],additionalProperties:false}},
] as const;

export class ButlerTools {
  constructor(private tasks:TaskManager, private store:Store,private config:Config){}
  async execute(name:string,args:unknown,callId?:string):Promise<unknown> {
    switch(name){
      case 'dispatch_task': return this.tasks.create(args,callId ? `tool:${callId}` : undefined);
      case 'list_tasks': z.object({}).strict().parse(args); return this.store.tasks().slice(-20).map(({logs,...task})=>task);
      case 'get_task_status': return this.tasks.get(z.object({taskId:z.string().uuid()}).strict().parse(args).taskId);
      case 'cancel_task': return this.tasks.cancel(z.object({taskId:z.string().uuid()}).strict().parse(args).taskId);
      case 'remember_preference': {
        const data=z.object({key:z.string().trim().min(1).max(60),value:z.string().trim().min(1).max(500)}).strict().parse(args);
        if(/key|secret|token|password|密码|密钥|令牌/i.test(data.key) || /sk-[a-zA-Z0-9_-]{12,}/.test(data.value))throw new ApiError(400,'偏好记忆不接受凭据');
        this.store.put('preference',data.key,{...data,value:this.config.redact(data.value)});return {saved:true,key:data.key};
      }
      default:throw new ApiError(400,'未知工具');
    }
  }
}
