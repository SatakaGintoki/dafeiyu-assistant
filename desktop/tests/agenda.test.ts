import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgendaItem, AgendaNotification, AgendaSnapshot } from '../../shared/agenda';
import { AgendaStore } from '../src/lib/agenda';
import { diffPayload, emptyForm, formFromItem, payloadFromForm } from '../src/lib/agendaForm';
import { dayRange, fromLocalInput, inQuietHours, localDate, toLocalInput, weekStart } from '../src/lib/agendaTime';
import { ApiError, createApi, withIdempotency } from '../src/lib/api';
import { deliverReminders } from '../src/lib/reminders';
import type { StreamItem, Transport } from '../src/lib/types';

const note = (id: string, status: AgendaNotification['status'], extra: Partial<AgendaNotification> = {}): AgendaNotification => ({
  id, itemId: 'i', itemRevision: 1, title: 't', scheduledAt: '2026-10-08T12:00:00.000Z', occurrenceAt: null,
  createdAt: '', status, snoozedUntil: null, revision: 1, updatedAt: '', ...extra,
});

test('wall-clock conversion goes through the record time zone, not UTC slicing', () => {
  assert.equal(fromLocalInput('2026-10-08T20:00', 'Asia/Shanghai'), '2026-10-08T12:00:00Z');
  assert.equal(toLocalInput('2026-10-08T12:00:00.000Z', 'Asia/Shanghai'), '2026-10-08T20:00');
  assert.equal(toLocalInput('2026-10-08T12:00:00.000Z', 'America/New_York'), '2026-10-08T08:00');
  // Nonexistent DST time moves forward (compatible), like the backend.
  assert.equal(fromLocalInput('2026-03-08T02:30', 'America/New_York'), '2026-03-08T07:30:00Z');
  assert.equal(localDate('2026-10-08T17:00:00Z', 'Asia/Shanghai'), '2026-10-09');
  assert.deepEqual(dayRange('2026-10-08', 'Asia/Shanghai'), { from: '2026-10-07T16:00:00Z', to: '2026-10-08T16:00:00Z' });
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(inQuietHours({ timezone: 'Asia/Shanghai', quietStart: '23:00', quietEnd: '08:00' }, Date.parse('2026-10-08T16:00:00Z')), true);
  assert.equal(inQuietHours({ timezone: 'Asia/Shanghai', quietStart: '23:00', quietEnd: '08:00' }, Date.parse('2026-10-08T04:00:00Z')), false);
});

test('item form validation, kind-specific clearing and minimal diffs', () => {
  const tz = 'Asia/Shanghai';
  assert.match(payloadFromForm(emptyForm(tz, { kind: 'event', title: 'x' })).error!, /开始和结束/);
  assert.match(payloadFromForm(emptyForm(tz, { title: 'x', reminder: 'before' })).error!, /截止时间/);
  assert.match(payloadFromForm(emptyForm(tz, { kind: 'event', title: 'x', startsAt: '2026-10-08T10:00', endsAt: '2026-10-08T09:00' })).error!, /晚于/);
  assert.match(payloadFromForm(emptyForm('Mars/Base', { title: 'x' })).error!, /时区/);
  const ev = payloadFromForm(emptyForm(tz, { kind: 'event', title: '游泳', startsAt: '2026-10-08T19:00', endsAt: '2026-10-08T20:00', repeat: 'weekly', interval: 2, weekdays: [4, 1], reminder: 'before', reminderMinutes: 30, exceptions: ['2026-10-22'] })).payload!;
  assert.deepEqual(ev.recurrence, { frequency: 'weekly', interval: 2, weekdays: [1, 4], exceptions: ['2026-10-22'] });
  assert.equal(ev.dueAt, null); assert.equal(ev.reminderMinutesBefore, 30); assert.equal(ev.reminderAt, null);
  const noteP = payloadFromForm(emptyForm(tz, { kind: 'note', title: 'n', dueAt: '2026-10-08T10:00', reminder: 'at', reminderAt: '2026-10-08T09:00' })).payload!;
  assert.equal(noteP.dueAt, null); assert.equal(noteP.reminderAt, null);

  const item: AgendaItem = { id: 'a', projectId: null, kind: 'event', title: '游泳', notes: '', status: 'open', timezone: tz, dueAt: null,
    startsAt: '2026-10-08T11:00:00.000Z', endsAt: '2026-10-08T12:00:00.000Z', reminderAt: null, reminderMinutesBefore: 30,
    recurrence: { frequency: 'weekly', interval: 1, exceptions: [] }, planId: null, revision: 3, createdAt: '', updatedAt: '' };
  const form = formFromItem(item);
  assert.equal(form.startsAt, '2026-10-08T19:00');
  // Untouched form: nothing to send (no instant format churn, no recurrence rewrite).
  assert.deepEqual(diffPayload(item, payloadFromForm(form).payload!), {});
  assert.deepEqual(diffPayload(item, payloadFromForm({ ...form, title: '游泳课' }).payload!), { title: '游泳课' });
});

test('reminder delivery: once per id, re-pop only after snooze, quiet hours hold back, stale ids forgotten', () => {
  let r = deliverReminders([note('a', 'pending'), note('b', 'snoozed')], {}, false);
  assert.deepEqual(r.show.map(n => n.id), ['a']);
  // Reconnect / reopened window with the same snapshot, or only title/revision changed: nothing new.
  r = deliverReminders([note('a', 'pending', { title: 'renamed', revision: 2 }), note('b', 'snoozed')], r.log, false);
  assert.deepEqual(r.show, []);
  // b wakes up from snooze → shown once.
  r = deliverReminders([note('a', 'pending'), note('b', 'pending')], r.log, false);
  assert.deepEqual(r.show.map(n => n.id), ['b']);
  // a handled elsewhere, disappears from snapshot → dropped from log.
  r = deliverReminders([note('b', 'pending')], r.log, false);
  assert.deepEqual(Object.keys(r.log), ['b']);
  // Quiet hours: new one not shown nor recorded, shows when quiet ends.
  r = deliverReminders([note('b', 'pending'), note('c', 'pending')], r.log, true);
  assert.deepEqual(r.show, []); assert.equal(r.log.c, undefined);
  r = deliverReminders([note('b', 'pending'), note('c', 'pending')], r.log, false);
  assert.deepEqual(r.show.map(n => n.id), ['c']);
  // A burst is capped and summarised.
  r = deliverReminders(['1', '2', '3', '4', '5'].map(id => note(id, 'pending')), {}, false);
  assert.equal(r.show.length, 3); assert.equal(r.overflow, 2);
});

test('network retries reuse one idempotency key; HTTP errors are not retried', async () => {
  const keys: string[] = [];
  let calls = 0;
  const value = await withIdempotency(async key => { keys.push(key); if (++calls < 3) throw new ApiError(0, 'offline'); return 'ok'; }, 2, async () => {});
  assert.equal(value, 'ok'); assert.equal(new Set(keys).size, 1); assert.equal(keys.length, 3);
  calls = 0;
  await assert.rejects(withIdempotency(async () => { calls++; throw new ApiError(409, 'conflict'); }, 2, async () => {}), /conflict/);
  assert.equal(calls, 1);
});

test('calendar query encodes the offset plus sign', async () => {
  const paths: string[] = [];
  const transport: Transport = { request: async (_m, path) => { paths.push(path); return { status: 200, body: [] }; }, subscribe: () => () => {}, connection: async () => 'online' };
  await createApi(transport).agenda.calendar('2026-10-08T00:00:00+08:00', '2026-10-09T00:00:00+08:00');
  assert.match(paths[0], /from=2026-10-08T00%3A00%3A00%2B08%3A00/);
});

function snapshot(notifications: AgendaNotification[] = []): AgendaSnapshot {
  return { projects: [], items: [], plans: [], notifications, preferences: { timezone: 'Asia/Shanghai', quietStart: null, quietEnd: null },
    scheduler: { running: true, lastTickAt: null, lastError: null, intervalMs: 15000, delivery: 'frontend', requiresBackendRunning: true }, now: '' };
}

test('agenda store: events trigger one snapshot read, 401 stops, reminders deduped across store instances', async () => {
  let listener: (item: StreamItem) => void = () => {};
  let reads = 0, status = 200;
  let body = snapshot([note('a', 'pending')]);
  const transport: Transport = {
    request: async () => { reads++; await new Promise(r => setTimeout(r, 5)); return { status, body: status === 200 ? body : { error: 'bad token' } }; },
    subscribe: l => { listener = l; return () => {}; }, connection: async () => 'online',
  };
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  const shown: string[] = [];
  const store = new AgendaStore(createApi(transport).agenda, transport, { popups: true, storage });
  store.onReminders(list => shown.push(...list.map(n => n.id)));
  store.start();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(store.get().status, 'ready'); assert.deepEqual(shown, ['a']);
  reads = 0;
  for (let i = 0; i < 5; i++) listener({ kind: 'event', event: { seq: i + 1, type: 'agenda.changed', data: {}, at: '' } });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(reads, 1);
  // A replayed agenda.reminder for a notification no longer pending isn't shown: only the snapshot counts.
  body = snapshot([]);
  listener({ kind: 'event', event: { seq: 9, type: 'agenda.reminder', data: note('z', 'pending'), at: '' } });
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(shown, ['a']);
  // A fresh store (reopened window) with the same storage does not re-pop.
  body = snapshot([note('a', 'pending')]);
  const again = new AgendaStore(createApi(transport).agenda, transport, { popups: true, storage });
  const shown2: string[] = []; again.onReminders(list => shown2.push(...list.map(n => n.id)));
  await again.refresh();
  assert.deepEqual(shown2, ['a'], 'a was forgotten when it left the snapshot, so it may pop once more');
  await again.refresh();
  assert.deepEqual(shown2, ['a']);
  status = 401;
  await store.refresh();
  assert.equal(store.get().status, 'unauthorized');
  assert.ok(store.get().snapshot, 'last data kept visible');
  store.stop(); again.stop();
});

test('agenda store run(): 409 re-reads before surfacing, success upserts server value', async () => {
  let reads = 0;
  let body = snapshot();
  const transport: Transport = { request: async () => { reads++; return { status: 200, body }; }, subscribe: () => () => {}, connection: async () => 'online' };
  const store = new AgendaStore(createApi(transport).agenda, transport);
  await store.refresh();
  reads = 0;
  await assert.rejects(store.run('items', async () => { throw new ApiError(409, '记录已修改'); }), /记录已修改/);
  assert.equal(reads, 1);
  const item = { id: 'x', revision: 2 } as AgendaItem;
  body = { ...snapshot(), items: [item] };
  await store.run('items', async () => item);
  assert.equal(store.item('x'), item);
  // An older idempotent replay doesn't roll back a newer copy.
  await store.run('items', async () => ({ id: 'x', revision: 1 }) as AgendaItem);
  assert.equal(store.item('x')?.revision, 2);
});
