import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store';
import { ApiError } from './config';
import type { AgendaProject } from '../shared/agenda';
import type { ProjectMemory } from '../shared/project-memory';

export const memoryInput = z.object({projectId:z.string().uuid(),kind:z.enum(['goal','progress','next','context']),content:z.string().trim().min(1).max(2000)}).strict();
export const memoryUpdate = memoryInput.omit({projectId:true}).partial().extend({revision:z.number().int().positive()}).strict();
const version = z.object({revision:z.number().int().positive()}).strict();
const stable = (value:unknown):string => JSON.stringify(value, (_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

export class ProjectMemories {
  constructor(private store:Store,private emit:(type:string,data:unknown)=>unknown,private redact:(text:string)=>string=text=>text){}
  list(projectId:string) { this.project(projectId); return this.store.list<ProjectMemory>('project-memory').filter(m=>m.projectId===projectId); }
  private project(id:string) { z.string().uuid().parse(id);const p=this.store.get<AgendaProject>('agenda-project',id);if(!p)throw new ApiError(404,'事务项目不存在');return p; }
  get(id:string) {z.string().uuid().parse(id);const m=this.store.get<ProjectMemory>('project-memory',id);if(!m)throw new ApiError(404,'项目记忆不存在');return m;}
  mutate(operation:'create'|'update'|'delete',id:string|undefined,input:unknown,key?:string,messageId?:string):ProjectMemory {
    if(key&&!/^[\w.:-]{1,200}$/.test(key))throw new ApiError(400,'无效的幂等键');
    const fingerprint=stable({operation,id,input,messageId});
    const previous=key?this.store.get<{fingerprint:string;result:ProjectMemory}>('memory-request',key):undefined;
    if(previous){if(previous.fingerprint!==fingerprint)throw new ApiError(409,'幂等键已用于其他请求');return previous.result;}
    let result:ProjectMemory;
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const source:ProjectMemory['source']=messageId?{type:'conversation',messageId}:{type:'manual'};
      if(messageId){const message=this.store.messages().find(m=>m.id===messageId);if(!message||message.role!=='user')throw new ApiError(400,'记忆来源必须是用户消息');}
      if(operation==='create') {
        const data=memoryInput.parse(input);if(this.project(data.projectId).archived)throw new ApiError(409,'项目已归档');
        result={...data,id:randomUUID(),revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),source};
      } else {
        const old=this.get(id!);const data=operation==='delete'?version.parse(input):memoryUpdate.parse(input);
        if(data.revision!==old.revision)throw new ApiError(409,'记忆已修改，请刷新后再操作');
        if(operation==='update'&&this.project(old.projectId).archived)throw new ApiError(409,'项目已归档');
        result={...old,...data,revision:old.revision+1,updatedAt:new Date().toISOString(),source};
      }
      if(operation!=='delete'&&(this.redact(result.content)!==result.content||/sk-[a-zA-Z0-9_-]{12,}|Bearer\s+\S+|(?:api[_ -]?key|password|密码|密钥)\s*[:：=]\s*\S+/i.test(result.content)))throw new ApiError(400,'项目记忆不接受凭据');
      if(operation==='delete')this.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('project-memory',result.id);
      else this.store.put('project-memory',result.id,result);
      if(key)this.store.put('memory-request',key,{fingerprint,result});
      this.store.db.exec('COMMIT');
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    this.emit('memory.changed',{projectId:result.projectId,id:result.id,operation});return result;
  }
}
