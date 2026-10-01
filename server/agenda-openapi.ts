import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as s from './agenda-schema';

const stamp={id:z.string().uuid(),revision:z.number().int().positive(),createdAt:s.instant,updatedAt:s.instant};
export const agendaResponseSchemas={
  AgendaProject:s.createProject.extend({...stamp,archived:z.boolean()}),
  AgendaItem:s.createItem.extend({...stamp,timezone:s.timezone,status:z.enum(['open','done','cancelled']),planId:z.string().uuid().nullable()}),
  AgendaPlan:s.createPlan.extend({...stamp,timezone:s.timezone,status:z.enum(['draft','accepted','cancelled']),itemIds:z.array(z.string().uuid())}),
  AgendaNotification:z.object({...stamp,deliveryGeneration:z.number().int().positive().optional(),itemId:z.string().uuid(),itemRevision:z.number().int().positive(),title:z.string(),scheduledAt:s.instant,occurrenceAt:s.instant.nullable(),status:z.enum(['pending','acknowledged','snoozed','cancelled']),snoozedUntil:s.instant.nullable()}).strict(),
  AgendaPreferences:s.preferences,
  AgendaOccurrence:z.object({id:z.string(),itemId:z.string().uuid(),title:z.string(),projectId:z.string().uuid().nullable(),startsAt:s.instant,endsAt:s.instant,reminderAt:s.instant.nullable()}).strict(),
};
const jsonSchema=(schema:z.ZodTypeAny)=>{const {$schema,...result}=zodToJsonSchema(schema,{$refStrategy:'none'});return result;};
const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const array=(name:string)=>({type:'array',items:ref(name)});
const content=(schema:unknown)=>({'application/json':{schema}});
const id={in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}};
const key={in:'header',name:'Idempotency-Key',required:false,schema:{type:'string',pattern:'^[\\w.:-]{1,160}$'},description:'重试复用原键及请求体；同键异请求返回409。重放返回原响应，随后重新查询最新状态。'};
const errors=Object.fromEntries([400,401,404,409].map(code=>[String(code),{description:code===409?'版本过期、幂等冲突或资源状态不允许':'参数无效、未认证或不存在',content:content(ref('Error'))}]));
const get=(schema:unknown)=>({responses:{'200':{description:'成功',content:content(schema)},...errors}});
const write=(input:z.ZodTypeAny,output:string,hasId=false,create=false)=>({parameters:[...(hasId?[id]:[]),key],requestBody:{required:true,content:content(jsonSchema(input))},responses:{[create?'201':'200']:{description:'已持久化',content:content(ref(output))},...errors}});
export const agendaSchemas={
  ...Object.fromEntries(Object.entries(agendaResponseSchemas).map(([name,schema])=>[name,jsonSchema(schema)])),
  AgendaSnapshot:{type:'object',required:['projects','items','plans','notifications','preferences','scheduler','now'],properties:{projects:array('AgendaProject'),items:array('AgendaItem'),plans:array('AgendaPlan'),notifications:array('AgendaNotification'),preferences:ref('AgendaPreferences'),now:{type:'string',format:'date-time'},scheduler:{type:'object',required:['running','lastTickAt','lastError','intervalMs','delivery','requiresBackendRunning'],properties:{running:{type:'boolean'},lastTickAt:{type:['string','null']},lastError:{type:['string','null']},intervalMs:{type:'integer'},delivery:{const:'frontend'},requiresBackendRunning:{const:true}}}}},
};
export const agendaPaths:Record<string,unknown>={
  '/api/v1/agenda':{get:{summary:'事务本完整快照；通知仅包含 pending/snoozed，独立于编码任务',...get(ref('AgendaSnapshot'))}},
  '/api/v1/agenda/calendar':{get:{summary:'展开未归档项目中的未完成日程；按重叠范围返回，最多366天',parameters:[{in:'query',name:'from',required:true,schema:{type:'string',format:'date-time'}},{in:'query',name:'to',required:true,schema:{type:'string',format:'date-time'}},{in:'query',name:'projectId',schema:{type:'string',format:'uuid'}}],...get(array('AgendaOccurrence'))}},
  '/api/v1/agenda/notifications':{get:get(array('AgendaNotification'))},
  '/api/v1/agenda/notifications/{id}/action':{post:write(s.notificationAction,'AgendaNotification',true)},
  '/api/v1/agenda/preferences':{get:get(ref('AgendaPreferences')),patch:write(s.preferences,'AgendaPreferences')},
  '/api/v1/agenda/plans/{id}/accept':{post:{summary:'仅用户确认后接受草案；原子创建关联待办',...write(s.revisionBody,'AgendaPlan',true)}},
  '/api/v1/agenda/plans/{id}/cancel':{post:write(s.revisionBody,'AgendaPlan',true)},
};
for(const [plural,name,create,patch] of [['projects','AgendaProject',s.createProject,s.patchProject],['items','AgendaItem',s.createItem,s.patchItem],['plans','AgendaPlan',s.createPlan,s.patchPlan]] as const){
  agendaPaths[`/api/v1/agenda/${plural}`]={get:get(array(name)),post:write(create,name,false,true)};
  agendaPaths[`/api/v1/agenda/${plural}/{id}`]={get:{parameters:[id],...get(ref(name))},patch:write(patch,name,true)};
}
