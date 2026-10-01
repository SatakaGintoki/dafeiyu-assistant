/** Independent of coding Project/Task. All instants are ISO 8601 with an offset. */
export interface AgendaProject {
  id:string; name:string; description:string; archived:boolean;
  revision:number; createdAt:string; updatedAt:string;
}
export interface AgendaRecurrence {
  frequency:'daily'|'weekly'; interval:number; weekdays?:number[];
  until?:string; exceptions:string[];
}
export interface AgendaItem {
  id:string; projectId:string|null; kind:'todo'|'event'|'note'; title:string; notes:string;
  status:'open'|'done'|'cancelled'; timezone:string;
  dueAt:string|null; startsAt:string|null; endsAt:string|null;
  reminderAt:string|null; reminderMinutesBefore:number|null;
  recurrence:AgendaRecurrence|null; planId:string|null;
  revision:number; createdAt:string; updatedAt:string;
}
export interface AgendaOccurrence {
  id:string; itemId:string; title:string; projectId:string|null;
  startsAt:string; endsAt:string; reminderAt:string|null;
}
export interface AgendaNotification {
  /** Durable activation generation; legacy records default to 1. */
  deliveryGeneration?:number;
  id:string; itemId:string; itemRevision:number; title:string;
  scheduledAt:string; occurrenceAt:string|null; createdAt:string;
  status:'pending'|'acknowledged'|'snoozed'|'cancelled'; snoozedUntil:string|null;
  revision:number; updatedAt:string;
}
export interface AgendaPlanStep {
  title:string; notes:string; dueAt:string|null; reminderAt:string|null;
}
export interface AgendaPlan {
  id:string; projectId:string|null; title:string; notes:string; timezone:string;
  status:'draft'|'accepted'|'cancelled'; steps:AgendaPlanStep[]; itemIds:string[];
  revision:number; createdAt:string; updatedAt:string;
}
export interface AgendaPreferences { timezone:string; quietStart:string|null; quietEnd:string|null }
export interface AgendaSnapshot {
  projects:AgendaProject[]; items:AgendaItem[]; plans:AgendaPlan[];
  notifications:AgendaNotification[]; preferences:AgendaPreferences;
  scheduler:{running:boolean; lastTickAt:string|null; lastError:string|null; intervalMs:number; delivery:'frontend'; requiresBackendRunning:true};
  now:string;
}
