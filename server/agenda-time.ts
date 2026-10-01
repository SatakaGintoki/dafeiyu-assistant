import { Temporal } from '@js-temporal/polyfill';
import type { AgendaItem, AgendaOccurrence } from '../shared/agenda';
import { ApiError } from './config';

/** Bounded expansion; local wall-clock recurrence preserves lesson times across DST. */
export function occurrences(item:AgendaItem,from:string,to:string):AgendaOccurrence[] {
  const lo=Date.parse(from),hi=Date.parse(to);
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo||hi-lo>366*86400000)throw new ApiError(400,'日程查询范围必须大于 0 且不超过 366 天');
  if(item.kind!=='event'||item.status!=='open')return [];
  const start=Temporal.Instant.from(item.startsAt!).toZonedDateTimeISO(item.timezone);
  const duration=Date.parse(item.endsAt!)-Date.parse(item.startsAt!);
  const r=item.recurrence;
  const result:AgendaOccurrence[]=[];
  const add=(at:number)=>{
    if(at>=hi||at+duration<=lo)return;
    result.push({id:`${item.id}:${new Date(at).toISOString()}`,itemId:item.id,title:item.title,projectId:item.projectId,startsAt:new Date(at).toISOString(),endsAt:new Date(at+duration).toISOString(),reminderAt:item.reminderMinutesBefore!==null?new Date(at-item.reminderMinutesBefore*60000).toISOString():item.reminderAt});
  };
  if(!r){add(Date.parse(item.startsAt!));return result;}
  const origin=start.toPlainDate();
  // Include an overlapping event that began before the requested range.
  let day=Temporal.Instant.fromEpochMilliseconds(lo-duration).toZonedDateTimeISO(item.timezone).toPlainDate();
  if(Temporal.PlainDate.compare(day,origin)<0)day=origin;
  const end=Temporal.Instant.fromEpochMilliseconds(hi).toZonedDateTimeISO(item.timezone).toPlainDate();
  const weekOrigin=origin.subtract({days:origin.dayOfWeek-1});
  for(;Temporal.PlainDate.compare(day,end)<=0;day=day.add({days:1})){
    if(r.until&&day.toString()>r.until)break;
    const days=origin.until(day).days;
    const matches=r.frequency==='daily'?days%r.interval===0:Math.floor(weekOrigin.until(day).days/7)%r.interval===0&&(r.weekdays||[origin.dayOfWeek]).includes(day.dayOfWeek);
    if(!matches||r.exceptions.includes(day.toString()))continue;
    const at=day.toPlainDateTime(start.toPlainTime()).toZonedDateTime(item.timezone,{disambiguation:'compatible'}).epochMilliseconds;
    if(at>=Date.parse(item.startsAt!))add(at);
  }
  return result;
}
