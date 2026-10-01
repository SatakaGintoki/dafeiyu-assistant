import { useSyncExternalStore } from 'react';
import { createApi, type Api } from './api';
import type { AppEvent, BackendPetState, Connection, ExecutorInfo, Message, Settings, StreamItem, Task, Transport } from './types';

export interface AppState {
  connection: Connection;
  ready: boolean;
  messages: Message[];
  tasks: Task[];
  settings?: Settings;
  executors: ExecutorInfo[];
  busy: boolean;
  petState: BackendPetState;
  progress: string;
  streamText: string;
}

/** Things the pet reacts to. Emitted only for live events, never for snapshots. */
export type Signal =
  | { type: 'task.created'; task: Task }
  | { type: 'task.finished'; task: Task }
  | { type: 'assistant.message'; message: Message }
  | { type: 'chat.error'; error: string }
  | { type: 'connection'; status: Connection };

const MAX = 200;
const petStates = new Set(['idle', 'thinking', 'working', 'waiting']);
const finished = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

export class Store {
  readonly api: Api;
  private state: AppState = { connection: 'connecting', ready: false, messages: [], tasks: [], executors: [], busy: false, petState: 'idle', progress: '', streamText: '' };
  private listeners = new Set<() => void>();
  private signalListeners = new Set<(signal: Signal) => void>();
  private syncing = false;
  private resync = false;
  private buffer: AppEvent[] = [];
  private lastSeq = 0;
  private receivedConnection = false;

  constructor(private transport: Transport) {
    this.api = createApi(transport);
    transport.subscribe(item => this.receive(item));
    void transport.connection().then(status => {
      if (this.receivedConnection) return;
      this.patch({ connection: status });
      if (status === 'online') void this.sync();
    }).catch(() => {
      if (!this.receivedConnection) this.patch({ connection: 'offline' });
    });
  }

  get = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  onSignal(listener: (signal: Signal) => void) { this.signalListeners.add(listener); return () => { this.signalListeners.delete(listener); }; }

  private patch(next: Partial<AppState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private signal(signal: Signal) { for (const listener of this.signalListeners) listener(signal); }

  private receive(item: StreamItem) {
    if (item.kind === 'connection') {
      this.receivedConnection = true;
      this.patch({ connection: item.status, ...(item.status !== 'online' ? { progress: '' } : {}) });
      this.signal({ type: 'connection', status: item.status });
      return;
    }
    if (item.kind === 'sync') { void this.sync(); return; }
    if (this.syncing) { this.buffer.push(item.event); return; }
    this.apply(item.event, true);
  }

  /** Snapshot first, then replay what arrived meanwhile; updates are ordered by updatedAt. */
  async sync() {
    if (this.syncing) { this.resync = true; return; }
    this.syncing = true;
    try {
      const snapshot = await this.api.state();
      this.patch({
        ready: true, messages: snapshot.messages, tasks: snapshot.tasks, settings: snapshot.settings,
        executors: snapshot.executors, busy: snapshot.busy,
        petState: petStates.has(snapshot.petState) ? snapshot.petState as BackendPetState : 'idle',
        progress: snapshot.chatProgress || '', streamText: snapshot.busy ? snapshot.chatStream?.text || '' : '',
      });
    } catch {
      // Stream status tells the UI whether the backend is reachable; keep the last known data.
    } finally {
      this.syncing = false;
      const pending = this.buffer; this.buffer = [];
      for (const event of pending) this.apply(event, true);
      if (this.resync) { this.resync = false; void this.sync(); }
    }
  }

  private apply(event: AppEvent, live: boolean) {
    if (event.seq && event.seq <= this.lastSeq) return;
    if (event.seq) this.lastSeq = event.seq;
    const data = event.data as any;
    switch (event.type) {
      case 'message.created': {
        const message = data as Message;
        if (this.state.messages.some(m => m.id === message.id)) return;
        this.patch({ messages: [...this.state.messages, message].slice(-MAX), ...(message.role==='assistant'&&!message.taskId?{streamText:''}:{}) });
        if (live && message.role === 'assistant' && !message.taskId) this.signal({ type: 'assistant.message', message });
        return;
      }
      case 'task.created':
      case 'task.updated': {
        const task = data as Task;
        const previous = this.state.tasks.find(t => t.id === task.id);
        if (previous && previous.updatedAt > task.updatedAt) return;
        const tasks = previous ? this.state.tasks.map(t => t.id === task.id ? task : t) : [...this.state.tasks, task].slice(-MAX);
        this.patch({ tasks });
        if (!live) return;
        if (!previous && event.type === 'task.created') this.signal({ type: 'task.created', task });
        if (finished.has(task.status) && (!previous || !finished.has(previous.status))) this.signal({ type: 'task.finished', task });
        return;
      }
      case 'task.log': {
        const { taskId, text, at } = data as { taskId: string; text: string; at: string };
        this.patch({ tasks: this.state.tasks.map(t => t.id === taskId && !t.logs.includes(text) ? { ...t, logs: [...t.logs, text].slice(-100), updatedAt: at > t.updatedAt ? at : t.updatedAt } : t) });
        return;
      }
      case 'chat.status':
        this.patch({ busy: !!data.busy, ...(data.busy ? {} : { progress: '', streamText: '' }), ...(petStates.has(data.petState) ? { petState: data.petState } : {}) });
        return;
      case 'chat.stream': if(this.state.busy)this.patch({streamText: String(data.text || '')}); return;
      case 'chat.progress': this.patch({ progress: String(data.text || '') }); return;
      case 'chat.error': if (live) this.signal({ type: 'chat.error', error: String(data.error || '') }); return;
      case 'settings.updated': this.patch({ settings: data as Settings }); return;
      case 'pet.state': if (petStates.has(data.state)) this.patch({ petState: data.state }); return;
    }
  }

  /** Optimistic busy flag so the UI reacts before the event round-trip. */
  markBusy() { this.patch({ busy: true, progress: '正在等待模型回复', streamText: '' }); }
  replaceTask(task: Task) {
    const exists = this.state.tasks.some(t => t.id === task.id);
    this.patch({ tasks: exists ? this.state.tasks.map(t => t.id === task.id && t.updatedAt <= task.updatedAt ? task : t) : [...this.state.tasks, task] });
  }
  setSettings(settings: Settings) { this.patch({ settings }); }
  async refreshExecutors() { try { this.patch({ executors: await this.api.executors() }); } catch { /* keep last list */ } }
}

export function useStore<T>(store: Store, select: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
