import { defineTool } from '@deepseek-ai/dsh-tools';
import agendaDefinitions from './agenda-tool-definitions.json' with { type: 'json' };

export const name = 'dayu-butler-tools';
export const inject = ['tools'];
const definitions = [
  ...agendaDefinitions.map(d=>({...d,parameters:Object.fromEntries(Object.entries(d.parameters.properties).map(([k,v])=>[k,{...v,...(d.parameters.required.includes(k)?{required:true}:{})}]))})),
  {name:'get_runtime_status',description:'Read current app version, executor discovery and Claude full-access setting. Historical failures are not current availability; discovery does not verify cloud connectivity.',parameters:{}},
  {name:'dispatch_task',description:'Only when the user explicitly requests execution, delegate a background task and immediately return its ID. Never claim it is already done.',parameters:{title:{type:'string',required:true},instruction:{type:'string',required:true},executor:{type:'string'},model:{type:'string'}}},
  {name:'list_tasks',description:'List real task states.',parameters:{}},
  {name:'get_task_status',description:'Read a task state and result.',parameters:{taskId:{type:'string',required:true}}},
  {name:'cancel_task',description:'Cancel a task only when the user requests it.',parameters:{taskId:{type:'string',required:true}}},
  {name:'resume_task',description:'Continue an unfinished task only when requested. Keep its task ID and prefer resuming its saved Claude session. Set fromFiles only if the user asks to abandon the session and continue from existing files.',parameters:{taskId:{type:'string',required:true},fromFiles:{type:'boolean'}}},
  {name:'remember_preference',description:'Save an explicitly stated user preference. Never store secrets.',parameters:{key:{type:'string',required:true},value:{type:'string',required:true}}},
];
export function apply(ctx) {
  for(const definition of definitions) ctx.tools.register(defineTool({
    ...definition,
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(args,exec) {
      const url=process.env.DAYU_INTERNAL_URL;
      if(!url || !process.env.DAYU_INTERNAL_TOKEN)throw new Error('Butler backend is not connected');
      const response=await fetch(url+'/internal/tool',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DAYU_INTERNAL_TOKEN},body:JSON.stringify({name:definition.name,args,callId:exec.callId}),signal:exec.signal});
      const body=await response.json(); if(!response.ok)throw new Error(body.error || 'Butler tool failed');
      return JSON.stringify(body);
    },
  }));
}
