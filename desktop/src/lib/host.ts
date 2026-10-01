import type { Connection, PanelTab, PetPrefs, StreamItem, Transport, ApiResponse } from './types';

export interface Rect { x: number; y: number; width: number; height: number }
type Off = () => void;

/** What the reminder deliverer last observed; shown so the user knows whether popups can actually reach them. */
export interface NotifierStatus {
  /** OS notifications usable at all on this machine/session. */
  supported: boolean;
  /** Last delivery failure (e.g. notifications disabled in Windows settings). */
  error?: string;
  /** Last time the deliverer read the backend inbox successfully. */
  checkedAt?: string;
  shown: number;
}

/** Window-level capabilities. Electron implements them in the main process; the browser preview fakes them. */
export interface Host {
  kind: 'electron' | 'web';
  transport: Transport;
  pet: {
    setInteractive(on: boolean): void;
    moveTo(x: number, y: number): void;
    moveEnd(): void;
    bounds(): Promise<Rect>;
    workArea(): Promise<Rect>;
    onCursor(listener: (point: { x: number; y: number }) => void): Off;
    menu(): void;
  };
  panel: {
    open(tab?: PanelTab): void;
    hide(): void;
    onOpen(listener: (tab?: PanelTab) => void): Off;
    onCloseRequest(listener: () => void): Off;
    onVisibility(listener: (visible: boolean) => void): Off;
  };
  prefs: { get(): Promise<PetPrefs>; set(patch: Partial<PetPrefs>): void; onChange(listener: (prefs: PetPrefs) => void): Off };
  reminders: {
    /** 'system': the Electron main process alone pops OS notifications. 'in-app': this page shows them itself. */
    mode: 'system' | 'in-app';
    status(): Promise<NotifierStatus>;
    onStatus(listener: (status: NotifierStatus) => void): Off;
    /** A reminder was clicked ("查看"); the panel should reveal it. */
    onFocus(listener: (notificationId: string) => void): Off;
    focus(notificationId: string): void;
  };
  startBackend(): Promise<{ ok: boolean; error?: string }>;
  openExternal(url: string): void;
  chooseFolder():Promise<string|undefined>;
  taskFiles(id:string,action:'reveal'|'recover',index?:number):Promise<{ok:boolean;path?:string;error?:string}>;
}

/** Shape exposed by electron/preload.ts via contextBridge. */
export interface DayuBridge extends Omit<Host, 'kind' | 'transport' | 'reminders'> {
  reminders: Omit<Host['reminders'], 'mode'>;
  api: {
    request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse>;
    connection(): Promise<Connection>;
    onStream(listener: (item: StreamItem) => void): Off;
  };
}

declare global { interface Window { dayu?: DayuBridge } }

export function electronHost(bridge: DayuBridge): Host {
  return {
    kind: 'electron',
    transport: { request: bridge.api.request, subscribe: bridge.api.onStream, connection: bridge.api.connection },
    pet: bridge.pet, panel: bridge.panel, prefs: bridge.prefs,
    reminders: { mode: 'system', ...bridge.reminders },
    startBackend: bridge.startBackend, openExternal: bridge.openExternal,
    chooseFolder:bridge.chooseFolder,taskFiles:bridge.taskFiles,
  };
}
