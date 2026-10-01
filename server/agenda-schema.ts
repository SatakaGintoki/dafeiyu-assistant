import { z } from 'zod';

export const instant=z.string().datetime({offset:true}).transform(s=>new Date(s).toISOString());
export const timezone=z.string().max(100).refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true;}catch{return false;}},'无效的 IANA 时区');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'无效的日期');
const title=z.string().trim().min(1).max(160);
const notes=z.string().max(8000);
const projectId=z.string().uuid().nullable();
export const recurrence=z.object({frequency:z.enum(['daily','weekly']),interval:z.number().int().min(1).max(52).default(1),weekdays:z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),until:date.optional(),exceptions:z.array(date).max(366).default([])}).strict().superRefine((r,c)=>{
  if(r.frequency==='daily'&&r.weekdays)c.addIssue({code:'custom',message:'daily 不接受 weekdays'});
  if(r.weekdays&&new Set(r.weekdays).size!==r.weekdays.length)c.addIssue({code:'custom',message:'weekdays 不可重复'});
});
export const createProject=z.object({name:title,description:notes.default('')}).strict();
export const patchProject=z.object({revision:z.number().int().positive(),name:title.optional(),description:notes.optional(),archived:z.boolean().optional()}).strict();
export const itemFields={projectId:projectId.default(null),kind:z.enum(['todo','event','note']),title,notes:notes.default(''),timezone:timezone.optional(),dueAt:instant.nullable().default(null),startsAt:instant.nullable().default(null),endsAt:instant.nullable().default(null),reminderAt:instant.nullable().default(null),reminderMinutesBefore:z.number().int().min(0).max(525600).nullable().default(null),recurrence:recurrence.nullable().default(null)};
export const createItem=z.object(itemFields).strict();
export const patchItem=z.object({...Object.fromEntries(Object.entries(itemFields).map(([k,v])=>[k,v.optional()])),revision:z.number().int().positive(),status:z.enum(['open','done','cancelled']).optional()}).strict();
export const planStep=z.object({title,notes:notes.default(''),dueAt:instant.nullable().default(null),reminderAt:instant.nullable().default(null)}).strict();
export const createPlan=z.object({projectId:projectId.default(null),title,notes:notes.default(''),timezone:timezone.optional(),steps:z.array(planStep).min(1).max(60)}).strict();
export const patchPlan=createPlan.partial().extend({revision:z.number().int().positive()}).strict();
export const revisionBody=z.object({revision:z.number().int().positive()}).strict();
const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable();
export const preferences=z.object({timezone,quietStart:clock,quietEnd:clock}).strict().refine(p=>(p.quietStart===null)===(p.quietEnd===null)&&(!p.quietStart||p.quietStart!==p.quietEnd),'免打扰起止时间必须同时设置，且不能相同');
export const notificationAction=z.object({revision:z.number().int().positive(),action:z.enum(['acknowledge','snooze']),until:instant.optional()}).strict().refine(x=>x.action==='snooze'?!!x.until:!x.until,'稍后提醒需要 until；确认不接受 until');
