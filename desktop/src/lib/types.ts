import type { AppEvent } from '../../../shared/types';
export type { Task, TaskStatus, Message, Settings, ExecutorInfo, Snapshot, AppEvent, Executor } from '../../../shared/types';

export type Connection = 'connecting' | 'online' | 'offline' | 'unauthorized';
export type BackendPetState = 'idle' | 'thinking' | 'working' | 'waiting';
export type PanelTab = 'chat' | 'tasks' | 'agenda' | 'settings';
export type PetSize = 's' | 'm' | 'l';
export interface PetPrefs { size: PetSize; walk: boolean; topmost: boolean; focus?: boolean }
export const defaultPrefs: PetPrefs = { size: 'm', walk: true, topmost: true, focus:false };

/** What the transport delivers: backend events, sync requests, and connection changes. */
export type StreamItem =
  | { kind: 'event'; event: AppEvent }
  | { kind: 'sync' }
  | { kind: 'connection'; status: Connection };

export interface ApiResponse { status: number; body: unknown }
export interface Transport {
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse>;
  subscribe(listener: (item: StreamItem) => void): () => void;
  connection(): Promise<Connection>;
}
