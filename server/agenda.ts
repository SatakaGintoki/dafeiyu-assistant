import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import type { Store } from './store';
import { ApiError } from './config';
import * as schema from './agenda-schema';
import { occurrences } from './agenda-time';
import type { AgendaItem, AgendaProject, AgendaPlan, AgendaNotification, AgendaPreferences, AgendaSnapshot } from '../shared/agenda';

const kinds={projects:'agenda-project',items:'agenda-item',plans:'agenda-plan',notifications:'agenda-notification'} as const;
type Entity=AgendaProject|AgendaItem|AgendaPlan|AgendaNotification;
const stable=(x:any):string=>JSON.stringify(x,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);

export class AgendaService {
  private timer?:ReturnType<typeof setInterval>;
  private lastTickAt:string|null=null;
  private lastError:string|null=null;
  readonly intervalMs=15000;
  constructor(private store:Store,private emit:(type:string,data:unknown)=>unknown,private clock:()=>number=Date.now){}
  private now(){return new Date(this.clock()).toISOString();}
  preferences():AgendaPreferences{return this.store.get<AgendaPreferences>('agenda-settings','default')||{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,quietStart:null,quietEnd:null};}
  snapshot():AgendaSnapshot{return {projects:this.store.list(kinds.projects),items:this.store.list(kinds.items),plans:this.store.list(kinds.plans),notifications:this.store.list<AgendaNotification>(kinds.notifications).filter(n=>n.status==='pending'||n.status==='snoozed'),preferences:this.preferences(),scheduler:{running:!!this.timer,lastTickAt:this.lastTickAt,lastError:this.lastError,intervalMs:this.intervalMs,delivery:'frontend',requiresBackendRunning:true},now:this.now()};}
  get<T extends Entity>(kind:keyof typeof kinds,id:string):T {
    z.string().uuid().parse(id);
    const record=this.store.get<T>(kinds[kind],id);
    if(!record)throw new ApiError(404,'事务记录不存在');return record;
  }
  private project(id:string|null){if(id&&this.get<AgendaProject>('projects',id).archived)throw new ApiError(409,'项目已归档，请先恢复项目');}
  private revision(record:Entity,input:{revision:number}){if(record.revision!==input.revision)throw new ApiError(409,'记录已修改，请刷新后再操作');}
  private stamp(){const now=this.now();return {id:randomUUID(),revision:1,createdAt:now,updatedAt:now};}
  private save(kind:keyof typeof kinds,value:Entity){this.store.put(kinds[kind],value.id,value);}
  private cancelNotifications(itemId:string){for(const n of this.store.list<AgendaNotification>(kinds.notifications))if(n.itemId===itemId&&['pending','snoozed'].includes(n.status))this.save('notifications',{...n,status:'cancelled',revision:n.revision+1,updatedAt:this.now()});}
  /** Entire mutation and deduplication record commit atomically. Events are invalidations, not the source of truth. */
  mutate(operation:string,input:unknown,key?:string):unknown {
    if(key&&!/^[\w.:-]{1,200}$/.test(key))throw new ApiError(400,'无效的幂等键');
    const fingerprint=stable({operation,input});
    if(key){const old=this.store.get<{fingerprint:string;result:unknown}>('agenda-request',key);if(old){if(old.fingerprint!==fingerprint)throw new ApiError(409,'幂等键已用于其他请求');return old.result;}}
    let result:unknown;
    this.store.db.exec('BEGIN IMMEDIATE');
    try{result=this.apply(operation,input);if(key)this.store.put('agenda-request',key,{fingerprint,result});this.store.db.exec('COMMIT');}
    catch(error){this.store.db.exec('ROLLBACK');throw error;}
    this.emit('agenda.changed',{operation,id:(result as any)?.id||null});return result;
  }
  private validateItem(item:AgendaItem){
    this.project(item.projectId);
    if(item.kind==='event'){
      if(!item.startsAt||!item.endsAt||Date.parse(item.endsAt)<=Date.parse(item.startsAt)||Date.parse(item.endsAt)-Date.parse(item.startsAt)>7*86400000)throw new ApiError(400,'日程必须包含起止时间，时长大于 0 且不超过 7 天');
      if(item.dueAt)throw new ApiError(400,'日程使用 startsAt/endsAt，不接受 dueAt');
    }else if(item.startsAt||item.endsAt||item.recurrence)throw new ApiError(400,'只有日程可以设置起止时间和重复规则');
    if(item.kind==='note'&&(item.dueAt||item.reminderAt||item.reminderMinutesBefore!==null))throw new ApiError(400,'笔记不接受截止时间或提醒');
    if(item.reminderAt&&item.reminderMinutesBefore!==null)throw new ApiError(400,'绝对提醒与提前提醒不能同时设置');
    if(item.reminderMinutesBefore!==null&&!(item.kind==='event'?item.startsAt:item.dueAt))throw new ApiError(400,'提前提醒必须有日程开始时间或待办截止时间');
    if(item.recurrence&&item.reminderAt)throw new ApiError(400,'重复日程使用 reminderMinutesBefore');
    if(item.recurrence?.until&&item.recurrence.until<Temporal.Instant.from(item.startsAt!).toZonedDateTimeISO(item.timezone).toPlainDate().toString())throw new ApiError(400,'重复结束日期早于开始日期');
  }
  private apply(operation:string,value:unknown):unknown {
    switch(operation){
      case 'project.create': {const data=schema.createProject.parse(value);if(this.store.list<AgendaProject>(kinds.projects).some(p=>!p.archived&&p.name===data.name))throw new ApiError(409,'同名项目已存在');const p={...data,...this.stamp(),archived:false};this.save('projects',p);return p;}
      case 'project.update': {
        const {id,...body}=z.object({id:z.string().uuid()}).passthrough().parse(value);const data=schema.patchProject.parse(body);const p=this.get<AgendaProject>('projects',id);this.revision(p,data);
        const next={...p,...data,revision:p.revision+1,updatedAt:this.now()};
        if(!next.archived&&this.store.list<AgendaProject>(kinds.projects).some(x=>x.id!==id&&!x.archived&&x.name===next.name))throw new ApiError(409,'同名项目已存在');
        this.save('projects',next);
        if(next.archived)for(const i of this.store.list<AgendaItem>(kinds.items))if(i.projectId===id)this.cancelNotifications(i.id);
        return next;
      }
      case 'item.create': {const data=schema.createItem.parse(value);const item:AgendaItem={...data,...this.stamp(),timezone:data.timezone||this.preferences().timezone,status:'open',planId:null};this.validateItem(item);this.save('items',item);return item;}
      case 'item.update': {
        const {id,...body}=z.object({id:z.string().uuid()}).passthrough().parse(value);const data=schema.patchItem.parse(body);const old=this.get<AgendaItem>('items',id);this.revision(old,data);
        const item={...old,...data,revision:old.revision+1,updatedAt:this.now()} as AgendaItem;this.validateItem(item);this.save('items',item);
        const scheduleFields=['status','projectId','kind','timezone','dueAt','startsAt','endsAt','reminderAt','reminderMinutesBefore','recurrence'] as const;
        if(scheduleFields.some(k=>stable(old[k])!==stable(item[k])))this.cancelNotifications(id);
        else for(const n of this.store.list<AgendaNotification>(kinds.notifications))if(n.itemId===id&&['pending','snoozed'].includes(n.status))this.save('notifications',{...n,title:item.title,itemRevision:item.revision,revision:n.revision+1,updatedAt:this.now()});
        return item;
      }
      case 'plan.create': {const data=schema.createPlan.parse(value);this.project(data.projectId);const plan:AgendaPlan={...data,...this.stamp(),timezone:data.timezone||this.preferences().timezone,status:'draft',itemIds:[]};this.save('plans',plan);return plan;}
      case 'plan.update': {
        const {id,...body}=z.object({id:z.string().uuid()}).passthrough().parse(value);const data=schema.patchPlan.parse(body);const old=this.get<AgendaPlan>('plans',id);this.revision(old,data);if(old.status!=='draft')throw new ApiError(409,'只有草案可以修改');
        const plan={...old,...data,revision:old.revision+1,updatedAt:this.now()};this.project(plan.projectId);this.save('plans',plan);return plan;
      }
      case 'plan.accept': case 'plan.cancel': {
        const {id,revision}=z.object({id:z.string().uuid(),revision:z.number().int().positive()}).strict().parse(value);const old=this.get<AgendaPlan>('plans',id);this.revision(old,{revision});if(old.status!=='draft')throw new ApiError(409,'此计划已处理');this.project(old.projectId);
        const plan:AgendaPlan={...old,status:operation==='plan.accept'?'accepted':'cancelled',revision:old.revision+1,updatedAt:this.now()};
        if(plan.status==='accepted')plan.itemIds=plan.steps.map(step=>{
          const item=this.apply('item.create',{...step,projectId:plan.projectId,kind:'todo',timezone:plan.timezone}) as AgendaItem;
          item.planId=plan.id;this.save('items',item);return item.id;
        });
        this.save('plans',plan);return plan;
      }
      case 'notification.action': {
        const {id,...body}=z.object({id:z.string().uuid()}).passthrough().parse(value);const data=schema.notificationAction.parse(body);const old=this.get<AgendaNotification>('notifications',id);this.revision(old,data);
        if(!['pending','snoozed'].includes(old.status))throw new ApiError(409,'提醒已处理或失效');
        if(data.until&&(Date.parse(data.until)<=this.clock()||Date.parse(data.until)>this.clock()+366*86400000))throw new ApiError(400,'稍后提醒时间必须在未来 366 天内');
        const n:AgendaNotification={...old,status:data.action==='snooze'?'snoozed':'acknowledged',snoozedUntil:data.until||null,revision:old.revision+1,updatedAt:this.now()};this.save('notifications',n);return n;
      }
      case 'preferences.update': {const data=schema.preferences.parse(value);this.store.put('agenda-settings','default',data);return data;}
      default:throw new ApiError(400,'未知事务操作');
    }
  }
  calendar(from:string,to:string,projectId?:string){
    const range=z.object({from:schema.instant,to:schema.instant,projectId:z.string().uuid().optional()}).parse({from,to,projectId});
    if(Date.parse(range.to)<=Date.parse(range.from)||Date.parse(range.to)-Date.parse(range.from)>366*86400000)throw new ApiError(400,'日程查询范围必须大于 0 且不超过 366 天');
    const projects=new Map(this.store.list<AgendaProject>(kinds.projects).map(p=>[p.id,p]));
    return this.store.list<AgendaItem>(kinds.items).filter(i=>(!projectId||i.projectId===projectId)&&(!i.projectId||!projects.get(i.projectId)?.archived)).flatMap(i=>occurrences(i,range.from,range.to)).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  }
  private quiet(){const p=this.preferences();if(!p.quietStart||!p.quietEnd)return false;const time=new Intl.DateTimeFormat('en-GB',{timeZone:p.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(this.clock());return p.quietStart<p.quietEnd?time>=p.quietStart&&time<p.quietEnd:time>=p.quietStart||time<p.quietEnd;}
  /** Replay is durable. SSE is only a wake-up hint; frontend must reconcile the inbox. */
  tick(){
    this.lastTickAt=this.now();
    try{
      if(this.quiet()){this.lastError=null;return;}
      const now=this.clock();const snapshot=this.snapshot();const projects=new Map(snapshot.projects.map(p=>[p.id,p]));
      for(const item of snapshot.items){
        if(item.status!=='open'||item.projectId&&projects.get(item.projectId)?.archived)continue;
        let at:string|null=item.reminderAt,occurrenceAt:string|null=null;
        if(item.reminderMinutesBefore!==null){
          const offset=item.reminderMinutesBefore*60000;
          if(item.recurrence){
            // Collapse missed recurring reminders within the last 30 days to the latest per item.
            const candidates=occurrences(item,new Date(now-30*86400000+offset).toISOString(),new Date(now+offset+1).toISOString()).filter(o=>Date.parse(o.reminderAt!)<=now);
            const latest=candidates.at(-1);at=latest?.reminderAt||null;occurrenceAt=latest?.startsAt||null;
          }else {const anchor=item.kind==='event'?item.startsAt:item.dueAt;at=anchor?new Date(Date.parse(anchor)-offset).toISOString():null;occurrenceAt=item.startsAt;}
        }
        if(!at||Date.parse(at)>now)continue;
        // Stable across title edits/reopening: an occurrence is delivered at most once.
        const key=`${item.id}:${at}`;
        if(this.store.get('agenda-reminder-fired',key))continue;
        const notification:AgendaNotification={...this.stamp(),itemId:item.id,itemRevision:item.revision,title:item.title,scheduledAt:at,occurrenceAt,status:'pending',snoozedUntil:null};
        this.store.db.exec('BEGIN IMMEDIATE');
        try{this.save('notifications',notification);this.store.put('agenda-reminder-fired',key,{id:notification.id});this.store.db.exec('COMMIT');}catch(error){this.store.db.exec('ROLLBACK');throw error;}
        this.emit('agenda.reminder',notification);
      }
      for(const n of snapshot.notifications)if(n.status==='snoozed'&&Date.parse(n.snoozedUntil!)<=now){
        const item=this.get<AgendaItem>('items',n.itemId);if(item.status!=='open'||item.revision!==n.itemRevision||item.projectId&&projects.get(item.projectId)?.archived){this.cancelNotifications(item.id);continue;}
        const next:AgendaNotification={...n,status:'pending',snoozedUntil:null,revision:n.revision+1,updatedAt:this.now()};this.save('notifications',next);this.emit('agenda.reminder',next);
      }
      this.lastError=null;
    }catch{this.lastError='提醒检查失败，下一轮会重试';}
  }
  start(){if(this.timer)return;this.timer=setInterval(()=>this.tick(),this.intervalMs);this.timer.unref();this.tick();}
  close(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
}
