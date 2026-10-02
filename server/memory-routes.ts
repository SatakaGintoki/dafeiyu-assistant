import type { Express } from 'express';
import { z } from 'zod';
import type { ProjectMemories } from './project-memory';
import { ApiError } from './config';
export function addMemoryRoutes(app:Express,memories:ProjectMemories) {
  app.get('/api/v1/project-memories',(req,res)=>res.json(memories.list(z.object({projectId:z.string().uuid()}).strict().parse(req.query).projectId)));
  for(const [method,operation] of [['post','create'],['patch','update'],['delete','delete']] as const) {
    app[method]('/api/v1/project-memories'+(operation==='create'?'':'/:id'),(req,res)=>{
      const key=req.header('Idempotency-Key');if(key&&!/^[\w.:-]{1,160}$/.test(key))throw new ApiError(400,'无效的幂等键');
      res.status(operation==='create'?201:200).json(memories.mutate(operation,req.params.id as string|undefined,req.body,key?`http:${key}`:undefined));
    });
  }
}
