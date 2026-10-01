import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AgendaItem, AgendaNotification, AgendaOccurrence, AgendaPlan, AgendaProject, AgendaSnapshot } from '../../../shared/agenda';
import { ApiError, withIdempotency, type Api } from './api';
import { inQuietHours } from './agendaTime';
import { deliverReminders, type ShownLog } from './reminders';
import type { Transport } from './types';

export type AgendaStatus = 'loading' | 'ready' | 'error' | 'unauthorized';
export interface AgendaState {
  status: AgendaStatus;
  snapshot?: AgendaSnapshot;
  error?: string;
  /** Bumps on every applied snapshot; views that query the backend (calendar) refetch on change. */
  version: number;
}
type Collection = 'projects' | 'items' | 'plans' | 'notifications';
type Entity = AgendaProject | AgendaItem | AgendaPlan | AgendaNotification;

const LOG_KEY = 'dayu.agenda.shown';

/**
 * Agenda data lives on the backend; this keeps the latest snapshot and nothing else.
 * SSE events are invalidation hints: every one leads to a fresh GET, never to local state changes.
 * One snapshot request is in flight at a time, so a slow response can't overwrite a newer one.
 */
export class AgendaStore {
  private state: AgendaState = { status: 'loading', version: 0 };
  private listeners = new Set<() => void>();
  private reminderListeners = new Set<(list: AgendaNotification[], overflow: number) => void>();
  private loading = false;
  private again = false;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private off?: () => void;

  /** `popups`: this window shows in-app reminder popups itself (browser preview). Electron leaves it to the main process. */
  constructor(private api: Api['agenda'], private transport: Transport, private options: { popups: boolean; storage?: Pick<Storage, 'getItem' | 'setItem'> } = { popups: false }) {}

  get = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  onReminders(listener: (list: AgendaNotification[], overflow: number) => void) { this.reminderListeners.add(listener); return () => { this.reminderListeners.delete(listener); }; }

  start() {
    if (this.started) return;
    this.started = true;
    this.off = this.transport.subscribe(item => {
      if (item.kind === 'connection') {
        if (item.status === 'unauthorized') this.patch({ status: 'unauthorized', error: undefined });
        // The stream got through again, so the token works; resume normal loading.
        else if (item.status === 'online') void this.refresh();
        return;
      }
      if (item.kind === 'sync') { void this.refresh(); return; }
      if (item.event.type === 'agenda.changed' || item.event.type === 'agenda.reminder') this.schedule();
    });
    void this.refresh();
  }
  stop() { this.off?.(); this.off = undefined; this.started = false; clearTimeout(this.timer); }

  private patch(next: Partial<AgendaState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  /** Coalesces bursts of change events into one snapshot request. */
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 120);
  }

  async refresh(): Promise<void> {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    try {
      const snapshot = await this.api.snapshot();
      this.patch({ status: 'ready', snapshot, error: undefined, version: this.state.version + 1 });
      this.deliver(snapshot);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.patch({ status: 'unauthorized', error: error.message });
      // Keep the last snapshot visible; the banner explains it may be stale.
      else this.patch({ status: this.state.snapshot ? 'ready' : 'error', error: error instanceof Error ? error.message : '读取事务失败' });
    } finally {
      this.loading = false;
      if (this.again && this.state.status !== 'unauthorized') { this.again = false; void this.refresh(); }
      this.again = false;
    }
  }

  private deliver(snapshot: AgendaSnapshot) {
    if (!this.options.popups) return;
    const storage = this.options.storage ?? globalThis.localStorage;
    let log: ShownLog = {};
    try { log = JSON.parse(storage?.getItem(LOG_KEY) || '{}'); } catch { /* start fresh */ }
    const result = deliverReminders(snapshot.notifications, log, inQuietHours(snapshot.preferences));
    try { storage?.setItem(LOG_KEY, JSON.stringify(result.log)); } catch { /* storage full or blocked */ }
    if (result.show.length) for (const listener of this.reminderListeners) listener(result.show, result.overflow);
  }

  /**
   * Runs one user action with a stable idempotency key, shows the server's answer immediately,
   * then re-reads the snapshot. 409 and 401 also re-read (or stop) before the error reaches the UI.
   */
  async run<T extends Entity>(collection: Collection | null, action: (key: string) => Promise<T>): Promise<T> {
    try {
      const result = await withIdempotency(action);
      if (collection) this.upsert(collection, result);
      void this.refresh();
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.patch({ status: 'unauthorized', error: error.message });
      else if (error instanceof ApiError && error.status === 409) await this.refresh();
      throw error;
    }
  }

  private upsert(collection: Collection, entity: Entity) {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    const list = snapshot[collection] as Entity[];
    const old = list.find(x => x.id === entity.id);
    if (old && old.revision > entity.revision) return; // an idempotent replay may return an older version
    const next = old ? list.map(x => x.id === entity.id ? entity : x) : [...list, entity];
    this.patch({ snapshot: { ...snapshot, [collection]: next } });
  }

  item(id: string) { return this.state.snapshot?.items.find(i => i.id === id); }
  notification(id: string) { return this.state.snapshot?.notifications.find(n => n.id === id); }
}

export function useAgenda<T>(agenda: AgendaStore, select: (state: AgendaState) => T): T {
  return useSyncExternalStore(agenda.subscribe, () => select(agenda.get()));
}

/** Expanded event occurrences for [from, to); refetches when the snapshot changes. Stale responses are dropped. */
export function useCalendar(agenda: AgendaStore, api: Api['agenda'], from: string, to: string) {
  const version = useAgenda(agenda, s => s.version);
  const [result, setResult] = useState<{ key: string; data?: AgendaOccurrence[]; error?: string }>({ key: '' });
  const key = `${from}|${to}`;
  useEffect(() => {
    if (!version) return;
    let alive = true;
    api.calendar(from, to).then(
      data => { if (alive) setResult({ key, data }); },
      error => { if (alive) setResult(r => ({ key, data: r.key === key ? r.data : undefined, error: error instanceof Error ? error.message : '读取日程失败' })); },
    );
    return () => { alive = false; };
  }, [api, from, to, key, version]);
  const current = result.key === key ? result : { key, data: undefined, error: undefined };
  return { occurrences: current.data, error: current.error, loading: !current.data && !current.error };
}
