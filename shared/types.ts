export type Executor = 'codex' | 'claude' | 'zcode' | 'demo';
export type TaskStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface Task {
  id: string; title: string; instruction: string; executor: Executor; model: string;
  workspace: string; status: TaskStatus; createdAt: string; updatedAt: string;
  result: string; error: string; logs: string[]; parentId?: string;
}
export interface Message { id: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; taskId?: string }
export interface Settings {
  runtime: 'harness' | 'deepseek' | 'demo'; model: string; baseUrl: string;
  defaultExecutor: Executor; workspace: string; nickname: string;
  codexPath: string; claudePath: string; zcodePath: string; executorModel: string;
  taskTimeoutMinutes: number; hasApiKey: boolean;
}
export interface ExecutorInfo { id: Executor; name: string; available: boolean; detail: string }
export interface Snapshot { messages: Message[]; tasks: Task[]; settings: Settings; executors: ExecutorInfo[]; busy: boolean; petState: string }
export interface AppEvent { seq: number; type: string; data: unknown; at: string }
