import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function on<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

// Only narrow, purpose-built calls cross the bridge; the backend token stays in the main process.
contextBridge.exposeInMainWorld('dayu', {
  chooseFolder:()=>ipcRenderer.invoke('folder:choose'),
  taskFiles:(id:string,action:string,index?:number)=>ipcRenderer.invoke('task:files',{id,action,index}),
  api: {
    request: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => ipcRenderer.invoke('api:request', { method, path, body, headers }),
    connection: () => ipcRenderer.invoke('api:connection'),
    onStream: (listener: (item: unknown) => void) => on('api:stream', listener),
  },
  pet: {
    setInteractive: (value: boolean) => ipcRenderer.send('pet:interactive', value),
    moveTo: (x: number, y: number) => ipcRenderer.send('pet:move', x, y),
    moveEnd: () => ipcRenderer.send('pet:move-end'),
    bounds: () => ipcRenderer.invoke('pet:bounds'),
    workArea: () => ipcRenderer.invoke('pet:work-area'),
    onCursor: (listener: (point: unknown) => void) => on('pet:cursor', listener),
    menu: () => ipcRenderer.send('pet:menu'),
  },
  panel: {
    open: (tab?: string) => ipcRenderer.send('panel:open', tab),
    hide: () => ipcRenderer.send('panel:hide'),
    onOpen: (listener: (tab?: unknown) => void) => on('panel:opened', listener),
    onCloseRequest: (listener: () => void) => on('panel:close-request', listener),
    onVisibility: (listener: (visible: unknown) => void) => on('panel:visibility', listener),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch: unknown) => ipcRenderer.send('prefs:set', patch),
    onChange: (listener: (prefs: unknown) => void) => on('prefs:changed', listener),
  },
  startBackend: () => ipcRenderer.invoke('backend:start'),
  reminders: {
    status: () => ipcRenderer.invoke('reminders:status'),
    onStatus: (listener: (status: unknown) => void) => on('reminders:status', listener),
    onFocus: (listener: (id: unknown) => void) => on('reminders:focus', listener),
    focus: (id: string) => ipcRenderer.send('reminders:focus', id),
  },
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
});
