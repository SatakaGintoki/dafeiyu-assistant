import type { AgendaItem, AgendaRecurrence } from '../../../shared/agenda';
import { fromLocalInput, toLocalInput, validTimezone } from './agendaTime';

export type ReminderMode = 'none' | 'at' | 'before';
export interface ItemForm {
  kind: AgendaItem['kind'];
  title: string;
  notes: string;
  projectId: string; // '' = 收件箱
  timezone: string;
  dueAt: string; // datetime-local wall time in `timezone`
  startsAt: string;
  endsAt: string;
  reminder: ReminderMode;
  reminderAt: string;
  reminderMinutes: number;
  repeat: 'none' | 'daily' | 'weekly';
  interval: number;
  weekdays: number[];
  until: string;
  exceptions: string[];
}

/** Fields the backend schedules on. Any kind gets all of them so a kind change clears what no longer applies. */
export type ItemPayload = Pick<AgendaItem, 'kind' | 'title' | 'notes' | 'projectId' | 'timezone' | 'dueAt' | 'startsAt' | 'endsAt' | 'reminderAt' | 'reminderMinutesBefore' | 'recurrence'>;

export function emptyForm(timezone: string, defaults: Partial<ItemForm> = {}): ItemForm {
  return {
    kind: 'todo', title: '', notes: '', projectId: '', timezone, dueAt: '', startsAt: '', endsAt: '',
    reminder: 'none', reminderAt: '', reminderMinutes: 15, repeat: 'none', interval: 1, weekdays: [], until: '', exceptions: [],
    ...defaults,
  };
}

export function formFromItem(item: AgendaItem): ItemForm {
  const tz = item.timezone;
  const r = item.recurrence;
  return {
    kind: item.kind, title: item.title, notes: item.notes, projectId: item.projectId ?? '', timezone: tz,
    dueAt: toLocalInput(item.dueAt, tz), startsAt: toLocalInput(item.startsAt, tz), endsAt: toLocalInput(item.endsAt, tz),
    reminder: item.reminderAt ? 'at' : item.reminderMinutesBefore !== null ? 'before' : 'none',
    reminderAt: toLocalInput(item.reminderAt, tz), reminderMinutes: item.reminderMinutesBefore ?? 15,
    repeat: r ? r.frequency : 'none', interval: r?.interval ?? 1,
    // Empty weekdays = the start date's weekday (backend default); kept empty so an untouched rule isn't rewritten.
    weekdays: r?.weekdays ?? [],
    until: r?.until ?? '', exceptions: r?.exceptions ?? [],
  };
}

/** Validates the form and converts wall times in the chosen zone to instants. Returns a user-facing error instead of guessing. */
export function payloadFromForm(f: ItemForm): { payload?: ItemPayload; error?: string } {
  const title = f.title.trim();
  if (!title) return { error: '请填写标题' };
  if (!validTimezone(f.timezone)) return { error: '时区无效，请使用 IANA 名称，如 Asia/Shanghai' };
  const tz = f.timezone;
  const base = { kind: f.kind, title, notes: f.notes, projectId: f.projectId || null, timezone: tz };
  const none = { dueAt: null, startsAt: null, endsAt: null, reminderAt: null, reminderMinutesBefore: null, recurrence: null };
  if (f.kind === 'note') return { payload: { ...base, ...none } };

  const reminderAt = f.reminder === 'at' ? fromLocalInput(f.reminderAt, tz) : null;
  if (f.reminder === 'at' && !reminderAt) return { error: '请填写提醒时间' };
  const minutes = f.reminder === 'before' ? f.reminderMinutes : null;

  if (f.kind === 'todo') {
    const dueAt = fromLocalInput(f.dueAt, tz);
    if (f.dueAt && !dueAt) return { error: '截止时间无效' };
    if (minutes !== null && !dueAt) return { error: '“提前提醒”需要先设置截止时间' };
    return { payload: { ...base, ...none, dueAt, reminderAt, reminderMinutesBefore: minutes } };
  }

  const startsAt = fromLocalInput(f.startsAt, tz), endsAt = fromLocalInput(f.endsAt, tz);
  if (!startsAt || !endsAt) return { error: '日程需要开始和结束时间' };
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  if (length <= 0) return { error: '结束时间必须晚于开始时间' };
  if (length > 7 * 86400000) return { error: '单个日程不能超过 7 天' };
  let recurrence: AgendaRecurrence | null = null;
  if (f.repeat !== 'none') {
    if (f.reminder === 'at') return { error: '重复日程只能使用“提前提醒”' };
    if (!Number.isInteger(f.interval) || f.interval < 1 || f.interval > 52) return { error: '重复间隔需在 1–52 之间' };
    if (f.until && f.until < f.startsAt.slice(0, 10)) return { error: '重复结束日期早于开始日期' };
    recurrence = {
      frequency: f.repeat, interval: f.interval,
      ...(f.repeat === 'weekly' && f.weekdays.length ? { weekdays: [...f.weekdays].sort() } : {}),
      ...(f.until ? { until: f.until } : {}),
      exceptions: [...new Set(f.exceptions)].sort(),
    };
  }
  return { payload: { ...base, ...none, startsAt, endsAt, reminderAt, reminderMinutesBefore: minutes, recurrence } };
}

const instants = new Set(['dueAt', 'startsAt', 'endsAt', 'reminderAt']);
// Same instant may be spelled "…00.000Z" by the server and "…00Z" by Temporal.
const same = (key: string, a: unknown, b: unknown) => instants.has(key) && typeof a === 'string' && typeof b === 'string'
  ? Date.parse(a) === Date.parse(b) : JSON.stringify(a) === JSON.stringify(b);

/** Only what changed relative to `item`; unchanged fields are omitted so they aren't rewritten (and reminders aren't rescheduled). */
export function diffPayload(item: AgendaItem, payload: ItemPayload): Partial<ItemPayload> {
  const out: Partial<ItemPayload> = {};
  for (const key of Object.keys(payload) as (keyof ItemPayload)[]) {
    const before = key === 'recurrence' && item.recurrence ? normalizeRecurrence(item.recurrence) : item[key];
    if (!same(key, before, payload[key])) (out as Record<string, unknown>)[key] = payload[key];
  }
  return out;
}
function normalizeRecurrence(r: AgendaRecurrence): AgendaRecurrence {
  return {
    frequency: r.frequency, interval: r.interval,
    ...(r.weekdays?.length ? { weekdays: [...r.weekdays].sort() } : {}),
    ...(r.until ? { until: r.until } : {}),
    exceptions: [...r.exceptions].sort(),
  };
}
