import { Temporal } from '@js-temporal/polyfill';
import type { AgendaPreferences } from '../../../shared/agenda';

/**
 * All agenda instants are stored as UTC ISO strings; every record carries an IANA timezone.
 * Wall-clock values (form inputs, day grouping) are always derived through Temporal in that zone,
 * never by slicing a UTC string.
 */

const zoned = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
const pad = (n: number) => String(n).padStart(2, '0');
const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function systemTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
export function validTimezone(tz: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return !!tz; } catch { return false; }
}

/** Value for <input type="datetime-local"> showing the instant's wall time in `tz`. */
export function toLocalInput(iso: string | null, tz: string) {
  if (!iso) return '';
  const z = zoned(iso, tz);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}`;
}

/** Wall time in `tz` → UTC ISO. Nonexistent DST times shift forward, repeated ones take the earlier instant. */
export function fromLocalInput(value: string, tz: string): string | null {
  if (!value) return null;
  try {
    return Temporal.PlainDateTime.from(value).toZonedDateTime(tz, { disambiguation: 'compatible' }).toInstant().toString();
  } catch { return null; }
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(iso: string, tz: string) { return zoned(iso, tz).toPlainDate().toString(); }
export function todayIn(tz: string, now = Date.now()) { return localDate(new Date(now).toISOString(), tz); }

/** [start, end) of a local date in `tz`, as UTC ISO. */
export function dayRange(date: string, tz: string, days = 1) {
  const start = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz });
  const end = Temporal.PlainDate.from(date).add({ days }).toZonedDateTime({ timeZone: tz });
  return { from: start.toInstant().toString(), to: end.toInstant().toString() };
}
/** Monday of the week containing `date`. */
export function weekStart(date: string) {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}
export function addDays(date: string, days: number) { return Temporal.PlainDate.from(date).add({ days }).toString(); }
export function weekdayOf(date: string) { return Temporal.PlainDate.from(date).dayOfWeek; }
/** ISO weekday (Mon=1) of an instant in `tz`. */
export function weekdayAt(iso: string, tz: string) { return zoned(iso, tz).dayOfWeek; }

export function formatDate(date: string, today?: string) {
  const d = Temporal.PlainDate.from(date);
  const label = `${d.month}月${d.day}日 ${weekdayNames[d.dayOfWeek]}`;
  if (!today) return label;
  const diff = Temporal.PlainDate.from(today).until(d).days;
  return diff === 0 ? `今天 · ${label}` : diff === 1 ? `明天 · ${label}` : diff === -1 ? `昨天 · ${label}` : label;
}

/** Exact date and time in the record's zone; the zone is named when it differs from the viewer's. */
export function formatInstant(iso: string, tz: string, viewerTz?: string, withDate = true) {
  const z = zoned(iso, tz);
  const time = `${pad(z.hour)}:${pad(z.minute)}`;
  const nowYear = Temporal.Now.plainDateISO(tz).year;
  const date = `${z.year !== nowYear ? `${z.year}年` : ''}${z.month}月${z.day}日 ${weekdayNames[z.dayOfWeek]}`;
  const zone = viewerTz && viewerTz !== tz ? ` (${tz})` : '';
  return `${withDate ? `${date} ` : ''}${time}${zone}`;
}
export function formatTime(iso: string, tz: string) { const z = zoned(iso, tz); return `${pad(z.hour)}:${pad(z.minute)}`; }

/** Mirrors the backend scheduler's quiet-hours rule so the frontend doesn't pop system notifications during them. */
export function inQuietHours(prefs: Pick<AgendaPreferences, 'timezone' | 'quietStart' | 'quietEnd'>, now = Date.now()) {
  if (!prefs.quietStart || !prefs.quietEnd) return false;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return prefs.quietStart < prefs.quietEnd ? time >= prefs.quietStart && time < prefs.quietEnd : time >= prefs.quietStart || time < prefs.quietEnd;
}

export const reminderOptions: { minutes: number; label: string }[] = [
  { minutes: 0, label: '准时' }, { minutes: 5, label: '提前 5 分钟' }, { minutes: 10, label: '提前 10 分钟' },
  { minutes: 15, label: '提前 15 分钟' }, { minutes: 30, label: '提前 30 分钟' }, { minutes: 60, label: '提前 1 小时' },
  { minutes: 120, label: '提前 2 小时' }, { minutes: 1440, label: '提前 1 天' }, { minutes: 2880, label: '提前 2 天' },
  { minutes: 10080, label: '提前 1 周' },
];
export function reminderLabel(minutes: number) {
  return reminderOptions.find(o => o.minutes === minutes)?.label
    ?? (minutes % 1440 === 0 ? `提前 ${minutes / 1440} 天` : minutes % 60 === 0 ? `提前 ${minutes / 60} 小时` : `提前 ${minutes} 分钟`);
}
export const weekdayShort = weekdayNames;
