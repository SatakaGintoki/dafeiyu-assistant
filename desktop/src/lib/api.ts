import type { Settings, Snapshot, Task, Transport, ExecutorInfo } from './types';
import type { Project,TaskTemplate,Diagnostics,Preference } from '../../../shared/types';
import type { ConnectionCheck } from '../../../shared/types';
import type { MemoryInput, ProjectMemory } from '../../../shared/project-memory';
import type { AgendaItem, AgendaNotification, AgendaOccurrence, AgendaPlan, AgendaPreferences, AgendaProject, AgendaSnapshot } from '../../../shared/agenda';

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
    createTask: (input: { title: string; instruction: string; executor?: string; model?: string; projectId?: string }) =>
      call<Task>('POST', '/tasks', input, { 'Idempotency-Key': `ui-${crypto.randomUUID()}` }),
    cancelTask: (id: string) => call<Task>('POST', `/tasks/${id}/cancel`),
    retryTask: (id: string) => call<Task>('POST', `/tasks/${id}/retry`),
    resumeTask: (id: string,fromFiles=false) => call<Task>('POST', `/tasks/${id}/resume`,{fromFiles}),
    followup: (id: string, instruction: string) => call<Task>('POST', `/tasks/${id}/followup`, { instruction }),
    updateSettings: (patch: Partial<Settings> & { apiKey?: string }) => call<Settings>('PATCH', '/settings', patch),
    executors: () => call<ExecutorInfo[]>('GET', '/executors'),
    projects: () => call<Project[]>('GET','/projects'),
    addProject: (project:Omit<Project,'id'>) => call<Project>('POST','/projects',project),
    activateProject: (id:string) => call<Settings>('POST',`/projects/${id}/activate`),
    removeProject: (id:string) => call<void>('DELETE',`/projects/${id}`),
    templates: () => call<TaskTemplate[]>('GET','/templates'),
    addTemplate: (name:string,instruction:string) => call<TaskTemplate>('POST','/templates',{name,instruction}),
    removeTemplate: (id:string) => call<void>('DELETE',`/templates/${id}`),
    diagnostics: () => call<Diagnostics>('GET','/diagnostics'),
    checkConnection: () => call<ConnectionCheck>('POST','/connection-check',{}),
    memories: {
      list:(projectId:string)=>call<ProjectMemory[]>('GET',`/project-memories?projectId=${encodeURIComponent(projectId)}`),
      create:(input:MemoryInput,key:string)=>call<ProjectMemory>('POST','/project-memories',input,{'Idempotency-Key':key}),
      update:(id:string,input:Partial<Pick<ProjectMemory,'kind'|'content'>>&{revision:number},key:string)=>call<ProjectMemory>('PATCH',`/project-memories/${id}`,input,{'Idempotency-Key':key}),
      remove:(id:string,revision:number,key:string)=>call<ProjectMemory>('DELETE',`/project-memories/${id}`,{revision},{'Idempotency-Key':key}),
    },
    preferences: () => call<Preference[]>('GET','/preferences'),
    removePreference: (key:string) => call<void>('POST','/preferences/remove',{key}),
    savePreference: (key:string,value:string) => call<Preference>('POST','/preferences/save',{key,value}),
    agenda: agendaApi(call),
  };
}

type Call = <T>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<T>;
export type AgendaItemInput = Partial<Omit<AgendaItem, 'id' | 'revision' | 'createdAt' | 'updatedAt' | 'planId' | 'status'>> & { status?: AgendaItem['status'] };
export type AgendaPlanInput = Pick<AgendaPlan, 'title' | 'notes' | 'steps'> & { projectId?: string | null; timezone?: string };

export const newIdempotencyKey = () => `ui-${crypto.randomUUID()}`;

/**
 * One user action = one key. Network failures retry with the same key, so a write that reached the
 * server before the connection dropped is answered from the server's record instead of applied twice.
 */
export async function withIdempotency<T>(run: (key: string) => Promise<T>, retries = 2, wait = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const key = newIdempotencyKey();
  for (let attempt = 0; ; attempt++) {
    try { return await run(key); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 0 || attempt >= retries) throw error;
      await wait(400 * 3 ** attempt);
    }
  }
}

function agendaApi(call: Call) {
  const write = <T>(method: string, path: string, body: unknown, key: string) => call<T>(method, `/agenda${path}`, body, { 'Idempotency-Key': key });
  return {
    snapshot: () => call<AgendaSnapshot>('GET', '/agenda'),
    calendar: (from: string, to: string, projectId?: string) => {
      // URLSearchParams keeps the "+08:00" plus sign from turning into a space.
      const query = new URLSearchParams({ from, to, ...(projectId ? { projectId } : {}) });
      return call<AgendaOccurrence[]>('GET', `/agenda/calendar?${query}`);
    },
    createProject: (input: { name: string; description?: string }, key: string) => write<AgendaProject>('POST', '/projects', input, key),
    updateProject: (id: string, input: { revision: number; name?: string; description?: string; archived?: boolean }, key: string) => write<AgendaProject>('PATCH', `/projects/${id}`, input, key),
    createItem: (input: AgendaItemInput & Pick<AgendaItem, 'kind' | 'title'>, key: string) => write<AgendaItem>('POST', '/items', input, key),
    updateItem: (id: string, input: AgendaItemInput & { revision: number }, key: string) => write<AgendaItem>('PATCH', `/items/${id}`, input, key),
    createPlan: (input: AgendaPlanInput, key: string) => write<AgendaPlan>('POST', '/plans', input, key),
    updatePlan: (id: string, input: Partial<AgendaPlanInput> & { revision: number }, key: string) => write<AgendaPlan>('PATCH', `/plans/${id}`, input, key),
    acceptPlan: (id: string, revision: number, key: string) => write<AgendaPlan>('POST', `/plans/${id}/accept`, { revision }, key),
    cancelPlan: (id: string, revision: number, key: string) => write<AgendaPlan>('POST', `/plans/${id}/cancel`, { revision }, key),
    acknowledge: (id: string, revision: number, key: string) => write<AgendaNotification>('POST', `/notifications/${id}/action`, { revision, action: 'acknowledge' }, key),
    snooze: (id: string, revision: number, until: string, key: string) => write<AgendaNotification>('POST', `/notifications/${id}/action`, { revision, action: 'snooze', until }, key),
    updatePreferences: (input: AgendaPreferences, key: string) => write<AgendaPreferences>('PATCH', '/preferences', input, key),
  };
}
export type Api = ReturnType<typeof createApi>;
