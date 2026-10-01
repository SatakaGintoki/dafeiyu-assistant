import type { Express } from 'express';
import { z } from 'zod';
import type { AgendaService } from './agenda';
import { ApiError } from './config';

export function addAgendaRoutes(app:Express,agenda:AgendaService){
  app.get('/api/v1/agenda',(_req,res)=>res.json(agenda.snapshot()));
  app.get('/api/v1/agenda/calendar',(req,res)=>{
    const q=z.object({from:z.string(),to:z.string(),projectId:z.string().uuid().optional()}).strict().parse(req.query);
    res.json(agenda.calendar(q.from,q.to,q.projectId));
  });
  const mutation=(operation:string)=>(req:any,res:any)=>{
    const key=req.header('Idempotency-Key');if(key&&!/^[\w.:-]{1,160}$/.test(key))throw new ApiError(400,'无效的幂等键');
    const input=req.params.id?{...z.record(z.unknown()).parse(req.body),id:req.params.id}:req.body;
    res.status(operation.endsWith('.create')?201:200).json(agenda.mutate(operation,input,key?`http:${key}`:undefined));
  };
  for(const [plural,singular] of [['projects','project'],['items','item'],['plans','plan']] as const){
    app.get(`/api/v1/agenda/${plural}`,(_req,res)=>res.json(agenda.snapshot()[plural]));
    app.get(`/api/v1/agenda/${plural}/:id`,(req,res)=>res.json(agenda.get(plural,req.params.id as string)));
    app.post(`/api/v1/agenda/${plural}`,mutation(`${singular}.create`));
    app.patch(`/api/v1/agenda/${plural}/:id`,mutation(`${singular}.update`));
  }
  app.post('/api/v1/agenda/plans/:id/accept',mutation('plan.accept'));
  app.post('/api/v1/agenda/plans/:id/cancel',mutation('plan.cancel'));
  app.get('/api/v1/agenda/notifications',(_req,res)=>res.json(agenda.snapshot().notifications));
  app.post('/api/v1/agenda/notifications/:id/action',mutation('notification.action'));
  app.get('/api/v1/agenda/preferences',(_req,res)=>res.json(agenda.preferences()));
  app.patch('/api/v1/agenda/preferences',mutation('preferences.update'));
}
