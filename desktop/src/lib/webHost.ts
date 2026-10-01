import { SseClient } from './sse';
import type { Host, Rect } from './host';
import { defaultPrefs, type PanelTab, type PetPrefs, type StreamItem, type Transport } from './types';

type Listener<T> = (value: T) => void;
function emitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    emit(value: T) { for (const l of listeners) l(value); },
    on(listener: Listener<T>) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** State the browser preview renders: the fake desktop owns pet position and panel visibility. */
export interface WebDesk {
  pet: Rect;
  area: Rect;
  panelOpen: boolean;
  onPetMove: (listener: Listener<Rect>) => () => void;
  onPanel: (listener: Listener<{ open: boolean; tab?: PanelTab }>) => () => void;
  setArea(area: Rect): void;
  cursor(point: { x: number; y: number }): void;
  menu: (listener: Listener<void>) => () => void;
}

/**
 * Browser implementation of Host for `npm run dev:web`.
 * The Vite dev proxy injects the bearer token, so requests go same-origin without secrets in the page.
 */
export function webHost(): { host: Host; desk: WebDesk } {
  const stream = emitter<StreamItem>();
  const sse = new SseClient({ url: '/api/v1/events', headers: () => ({}), emit: item => stream.emit(item) });
  sse.start();

  const transport: Transport = {
    async request(method, path, body, headers) {
      const response = await fetch(path, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text.slice(0, 300) }; }
      return { status: response.status, body: parsed };
    },
    subscribe: listener => stream.on(listener),
    connection: async () => sse.connection,
  };

  const petMove = emitter<Rect>();
  const panelChange = emitter<{ open: boolean; tab?: PanelTab }>();
  const panelOpened = emitter<PanelTab | undefined>();
  const visibility = emitter<boolean>();
  const cursor = emitter<{ x: number; y: number }>();
  const prefsChange = emitter<PetPrefs>();
  const menu = emitter<void>();
  const reminderFocus = emitter<string>();
  let prefs: PetPrefs = { ...defaultPrefs, ...JSON.parse(localStorage.getItem('dayu.prefs') || '{}') };

  const desk: WebDesk = {
    pet: { x: 0, y: 0, width: 360, height: 460 },
    area: { x: 0, y: 0, width: 1280, height: 800 },
    panelOpen: false,
    onPetMove: petMove.on,
    onPanel: panelChange.on,
    setArea(area) { desk.area = area; },
    cursor: point => cursor.emit({ x: point.x - desk.pet.x, y: point.y - desk.pet.y }),
    menu: menu.on,
  };

  const setPanel = (open: boolean, tab?: PanelTab) => {
    const changed = desk.panelOpen !== open;
    desk.panelOpen = open;
    panelChange.emit({ open, tab });
    if (open) panelOpened.emit(tab);
    if (changed) visibility.emit(open);
  };

  const host: Host = {
    reminders: {
      mode: 'in-app',
      // The browser preview never asks for OS notification permission; reminders stay inside the page.
      status: async () => ({ supported: false, error: '浏览器预览只显示应用内提醒，系统通知需在桌面版验证', shown: 0 }),
      onStatus: () => () => {},
      onFocus: reminderFocus.on,
      // The panel may mount only after opening; give it a moment to subscribe.
      focus: id => { setPanel(true, 'agenda'); setTimeout(() => reminderFocus.emit(id), 300); },
    },
    chooseFolder:async()=>undefined,
    taskFiles:async()=>({ok:false,error:'浏览器预览不能打开本机文件，请使用桌面版'}),
    kind: 'web',
    transport,
    pet: {
      setInteractive() { /* the page is always interactive */ },
      moveTo(x, y) { desk.pet = { ...desk.pet, x: Math.round(x), y: Math.round(y) }; petMove.emit(desk.pet); },
      moveEnd() { /* nothing to persist */ },
      bounds: async () => desk.pet,
      workArea: async () => desk.area,
      onCursor: cursor.on,
      menu: () => menu.emit(),
    },
    panel: {
      open: tab => setPanel(true, tab),
      hide: () => setPanel(false),
      onOpen: panelOpened.on,
      onCloseRequest: () => () => {},
      onVisibility: visibility.on,
    },
    prefs: {
      get: async () => prefs,
      set(patch) { prefs = { ...prefs, ...patch }; localStorage.setItem('dayu.prefs', JSON.stringify(prefs)); prefsChange.emit(prefs); },
      onChange: prefsChange.on,
    },
    async startBackend() {
      return { ok: false, error: '浏览器预览无法启动后端，请运行「启动后端.cmd」' };
    },
    openExternal(url) { if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener'); },
  };
  return { host, desk };
}
