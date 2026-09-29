import type { Settings, Snapshot, Task, Transport, ExecutorInfo } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const fallback: Record<number, string> = {
  0: '连不上本地后端，请确认大肥鱼后端已启动',
  401: '本地令牌无效，请重启后端或检查 .data/api-token',
  409: '当前正忙，请稍后再试',
  503: '服务暂不可用',
};

export function createApi(transport: Transport) {
  async function call<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    let response;
    try { response = await transport.request(method, `/api/v1${path}`, body, headers); }
    catch { throw new ApiError(0, fallback[0]); }
    if (response.status >= 200 && response.status < 300) return response.body as T;
    const message = (response.body as { error?: string } | null)?.error || fallback[response.status] || `请求失败（${response.status}）`;
    throw new ApiError(response.status, message);
  }
  return {
    state: () => call<Snapshot>('GET', '/state'),
    chat: (message: string) => call<{ messageId: string }>('POST', '/chat', { message }),
    cancelChat: () => call<{ cancelled: boolean }>('POST', '/chat/cancel'),
    task: (id: string) => call<Task>('GET', `/tasks/${id}`),
    createTask: (input: { title: string; instruction: string; executor?: string; model?: string }) =>
      call<Task>('POST', '/tasks', input, { 'Idempotency-Key': `ui-${crypto.randomUUID()}` }),
    cancelTask: (id: string) => call<Task>('POST', `/tasks/${id}/cancel`),
    retryTask: (id: string) => call<Task>('POST', `/tasks/${id}/retry`),
    followup: (id: string, instruction: string) => call<Task>('POST', `/tasks/${id}/followup`, { instruction }),
    updateSettings: (patch: Partial<Settings> & { apiKey?: string }) => call<Settings>('PATCH', '/settings', patch),
    executors: () => call<ExecutorInfo[]>('GET', '/executors'),
  };
}
export type Api = ReturnType<typeof createApi>;
