export type Executor = 'codex' | 'claude' | 'zcode' | 'demo';
export type TaskStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface Task {
  id: string; title: string; instruction: string; executor: Executor; model: string;
  workspace: string; status: TaskStatus; createdAt: string; updatedAt: string;
  result: string; error: string; logs: string[]; parentId?: string;
  projectId?: string;
  sessionId?: string;
  resumeMode?: 'session' | 'workspace';
  attempts?: { at:string; status:TaskStatus; result:string; error:string; sessionId?:string }[];
  checkpoint?: { status: 'ready' | 'complete' | 'partial'; files: number; bytes: number; skipped: number; changes: FileChange[]; note?: string };
}
export interface FileChange { path: string; kind: 'added' | 'modified' | 'deleted' }
export interface Project { id: string; name: string; workspace: string; executor: Executor; notes: string }
export interface TaskTemplate { id: string; name: string; instruction: string }
export interface Preference { key: string; value: string }
export interface Diagnostics { version: string; checks: { name: string; ok: boolean; detail: string }[] }
export interface Message { id: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; taskId?: string }
export interface Settings {
  runtime: 'harness' | 'deepseek' | 'demo'; model: string; baseUrl: string;
  defaultExecutor: Executor; workspace: string; nickname: string;
  codexPath: string; claudePath: string; zcodePath: string; executorModel: string;
  claudeFullAccess?: boolean; taskTimeoutMinutes: number; hasApiKey: boolean;
}
export interface ExecutorInfo { id: Executor; name: string; available: boolean; detail: string }
export interface Snapshot { messages: Message[]; tasks: Task[]; settings: Settings; executors: ExecutorInfo[]; busy: boolean; petState: string; chatStream?: {id:string;text:string}; chatProgress?: string }
export interface AppEvent { seq: number; type: string; data: unknown; at: string }
