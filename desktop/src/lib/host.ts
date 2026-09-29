import type { Connection, PanelTab, PetPrefs, StreamItem, Transport, ApiResponse } from './types';

export interface Rect { x: number; y: number; width: number; height: number }
type Off = () => void;

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
  startBackend(): Promise<{ ok: boolean; error?: string }>;
  openExternal(url: string): void;
}

/** Shape exposed by electron/preload.ts via contextBridge. */
export interface DayuBridge extends Omit<Host, 'kind' | 'transport'> {
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
    startBackend: bridge.startBackend, openExternal: bridge.openExternal,
  };
}
