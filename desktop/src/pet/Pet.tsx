import { animate, AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { usePageVisible, usePrefs, useApp } from '../context';
import { useStore } from '../lib/store';
import type { PanelTab } from '../lib/types';
import { IconChat, IconMore, IconTasks } from '../ui/icons';
import { SpeechBubble, useBubbles } from './Bubble';
import { Effects, type EffectsHandle, type ParticleKind } from './Effects';
import { excerpt, greeting, line } from './lines';
import { hitSprite, loadMasks, SPRITES, type View } from './sprites';

export const PET_WINDOW = { width: 360, height: 460 };
const SCALE = { s: 0.56, m: 0.68, l: 0.8 } as const;
const FLOOR = 38; // px between the window bottom and the character's feet
const SLEEP_AFTER = 3 * 60_000;

export type Mood = 'idle' | 'thinking' | 'working' | 'waiting' | 'celebrate' | 'error' | 'sleeping' | 'offline' | 'dragging' | 'walking';
type Transient = { kind: 'celebrate' | 'error'; key: number } | null;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function Pet({ forcedMood }: { forcedMood?: Mood }) {
  const { host, store } = useApp();
  const prefs = usePrefs(host);
  const pageVisible = usePageVisible();
  const connection = useStore(store, s => s.connection);
  const busy = useStore(store, s => s.busy);
  const petState = useStore(store, s => s.petState);
  const progress = useStore(store, s => s.progress);
  const tasks = useStore(store, s => s.tasks);
  const nickname = useStore(store, s => s.settings?.nickname);
  const ready = useStore(store, s => s.ready);
  const name = nickname?.trim() || '主人';

  const running = useMemo(() => tasks.filter(t => t.status === 'running' || t.status === 'cancelling'), [tasks]);
  const queued = useMemo(() => tasks.filter(t => t.status === 'queued'), [tasks]);

  const [panelVisible, setPanelVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dockHover, setDockHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [walking, setWalking] = useState<'left' | 'right' | null>(null);
  const [transient, setTransient] = useState<Transient>(null);
  const [sleeping, setSleeping] = useState(false);
  const [glance, setGlance] = useState<'left' | 'right' | null>(null);
  const [dragFacing, setDragFacing] = useState<'left' | 'right'>('left');
  const [blush, setBlush] = useState(false);

  const bubbles = useBubbles();
  const effects = useRef<EffectsHandle>(null);
  const squashRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const lastActive = useRef(Date.now());

  // ---- mood ----
  const offline = connection === 'offline' || connection === 'unauthorized';
  const base: Mood = offline ? 'offline' : busy ? 'thinking' : running.length ? 'working' : queued.length ? 'waiting'
    : petState === 'idle' ? 'idle' : petState;
  const mood: Mood = forcedMood ?? (dragging ? 'dragging' : transient ? transient.kind : walking ? 'walking'
    : sleeping && base === 'idle' ? 'sleeping' : base);

  const view: View = mood === 'working' ? 'back'
    : mood === 'dragging' || mood === 'walking' || glance ? 'side' : 'front';
  const facing = mood === 'dragging' ? dragFacing : mood === 'walking' ? walking! : glance ?? 'left';
  const flip = view === 'side' && facing === 'right';

  // ---- geometry ----
  const scale = SCALE[prefs.size];
  const boxW = SPRITES.front.width * scale;
  const boxH = SPRITES.front.height * scale;
  const boxLeft = (PET_WINDOW.width - boxW) / 2;
  const boxTop = PET_WINDOW.height - FLOOR - boxH;
  const at = useCallback((u: number, v: number) => ({ x: boxLeft + u * boxW, y: boxTop + v * boxH }), [boxLeft, boxTop, boxW, boxH]);
  const burst = useCallback((kind: ParticleKind, count: number, u: number, v: number, spread?: number) =>
    effects.current?.burst(kind, count, at(u, v), spread), [at]);

  // ---- motion values ----
  const jumpY = useMotionValue(0);
  const leanTarget = useMotionValue(0);
  const lean = useSpring(leanTarget, { stiffness: 140, damping: 11, mass: 0.9 });
  const shadowScale = useTransform(jumpY, [-80, 0], [0.55, 1]);
  const shadowOpacity = useTransform(jumpY, [-80, 0], [0.25, 0.55]);

  const squash = useCallback((strength = 1) => {
    const el = squashRef.current;
    if (!el) return;
    const s = 0.12 * strength;
    animate(el, { scaleX: [1, 1 + s, 1 - s * 0.35, 1 + s * 0.1, 1], scaleY: [1, 1 - s, 1 + s * 0.45, 1 - s * 0.1, 1] },
      { duration: 0.55, ease: 'easeOut' });
  }, []);
  const hop = useCallback(async (height = 34, times = 1) => {
    for (let i = 0; i < times; i++) {
      await animate(jumpY, [0, -height * (i ? 0.55 : 1), 0], { duration: i ? 0.38 : 0.5, ease: [0.33, 0, 0.3, 1], times: [0, 0.45, 1] });
      squash(i ? 0.6 : 1);
    }
  }, [jumpY, squash]);

  const wake = useCallback(() => {
    lastActive.current = Date.now();
    setSleeping(was => {
      if (was) bubbles.say({ text: line.wake(), ttl: 2600 });
      return false;
    });
  }, [bubbles]);

  const flash = useCallback((kind: 'celebrate' | 'error') => {
    setTransient({ kind, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!transient) return;
    const timer = window.setTimeout(() => setTransient(null), transient.kind === 'celebrate' ? 2400 : 2000);
    return () => window.clearTimeout(timer);
  }, [transient]);

  // ---- mood entry effects ----
  useEffect(() => {
    if (!pageVisible) return;
    if (mood === 'celebrate') {
      void hop(46, 2);
      burst('sparkle', 10, 0.5, 0.3, 90);
      window.setTimeout(() => burst('star', 6, 0.5, 0.15, 70), 380);
    }
    if (mood === 'error') burst('sweat', 1, 0.74, 0.12);
    if (mood === 'working') {
      const timer = window.setInterval(() => burst('code', 1, rand(0.25, 0.75), 0.32, 70), 520);
      return () => window.clearInterval(timer);
    }
    if (mood === 'sleeping') {
      burst('zzz', 3, 0.66, 0.1, 30);
      const timer = window.setInterval(() => burst('zzz', 3, 0.66, 0.1, 30), 3600);
      return () => window.clearInterval(timer);
    }
  }, [mood, pageVisible, hop, burst]);

  // ---- panel visibility ----
  useEffect(() => host.panel.onVisibility(visible => {
    setPanelVisible(visible);
    if (visible) { wake(); setGlance('left'); window.setTimeout(() => setGlance(null), 1400); }
  }), [host, wake]);

  const openPanel = useCallback((tab?: PanelTab) => { wake(); bubbles.dismiss(); host.panel.open(tab); }, [host, bubbles, wake]);

  // ---- greeting + idle chatter + sleep ----
  const greeted = useRef(false);
  useEffect(() => {
    if (prefs.focus || greeted.current || connection !== 'online' || !ready) return;
    greeted.current = true;
    const timer=window.setTimeout(() => { bubbles.say({ text: greeting(name), ttl: 5200, tone: 'happy' }); void hop(24); }, 700);
    return ()=>window.clearTimeout(timer);
  }, [connection, ready, name, bubbles, hop, prefs.focus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActive.current;
      if (base === 'idle' && !hovered && !panelVisible && idleFor > SLEEP_AFTER) setSleeping(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [base, hovered, panelVisible]);

  useEffect(() => {
    if (prefs.focus || mood !== 'idle' || panelVisible || !pageVisible) return;
    const timer = window.setTimeout(() => bubbles.say({ text: line.idle(), ttl: 4000, priority: 0 }), rand(80_000, 160_000));
    return () => window.clearTimeout(timer);
  }, [mood, panelVisible, pageVisible, bubbles, prefs.focus]);

  // ---- backend signals ----
  const panelRef = useRef(panelVisible);
  panelRef.current = panelVisible;
  useEffect(() => store.onSignal(signal => {
    if (signal.type !== 'connection') wake();
    switch (signal.type) {
      case 'task.created':
        bubbles.say({ text: line.taskCreated(signal.task), tone: 'happy', ttl: 3600, priority: 2 });
        void hop(22);
        return;
      case 'task.finished': {
        const { task } = signal;
        const view = { label: '看看', run: () => openPanel('tasks'), primary: true };
        if (task.status === 'succeeded') {
          flash('celebrate');
          bubbles.say({ text: line.taskDone(task), tone: 'happy', ttl: 8000, priority: 3, actions: [view] });
        } else if (task.status === 'failed') {
          flash('error');
          bubbles.say({ text: line.taskFailed(task), tone: 'error', ttl: 9000, priority: 3, actions: [view] });
        } else if (task.status === 'interrupted') {
          bubbles.say({ text: line.taskInterrupted(task), tone: 'warn', ttl: 7000, priority: 2, actions: [view] });
        } else {
          bubbles.say({ text: line.taskCancelled(task), ttl: 3200, priority: 2 });
        }
        return;
      }
      case 'assistant.message':
        if (panelRef.current) { squash(0.5); return; }
        bubbles.say({
          text: excerpt(signal.message.content), ttl: 12000, priority: 2,
          actions: [{ label: '回复', run: () => openPanel('chat'), primary: true }],
        });
        void hop(18);
        return;
      case 'chat.error':
        flash('error');
        bubbles.say({ text: `出错了：${excerpt(signal.error, 60)}`, tone: 'error', ttl: 8000, priority: 3,
          actions: [{ label: '打开对话', run: () => openPanel('chat') }] });
        return;
      case 'connection':
        if (signal.status === 'online') bubbles.dismiss('offline');
        return;
    }
  }), [store, bubbles, hop, squash, flash, openPanel, wake]);

  // Offline gets a sticky bubble with a way out.
  const [starting, setStarting] = useState(false);
  const startBackend = useCallback(async () => {
    setStarting(true);
    bubbles.say({ id: 'offline', text: '正在叫醒后端，稍等一下…', ttl: 0, priority: 4 });
    const result = await host.startBackend();
    setStarting(false);
    if (!result.ok) bubbles.say({ id: 'offline', text: result.error || '没能启动后端', tone: 'error', ttl: 0, priority: 4,
      actions: [{ label: '再试一次', run: () => void startBackend(), primary: true }] });
  }, [host, bubbles]);
  useEffect(() => {
    if (connection === 'offline' && !starting) {
      const timer = window.setTimeout(() => bubbles.say({
        id: 'offline', text: '联系不上后端了…要我去启动它吗？', tone: 'warn', ttl: 0, priority: 4,
        actions: [{ label: '启动后端', run: () => void startBackend(), primary: true }, { label: '稍后', run: () => bubbles.dismiss('offline') }],
      }), 1500);
      return () => window.clearTimeout(timer);
    }
    if (connection === 'unauthorized') {
      bubbles.say({ id: 'offline', text: '后端不认识我的令牌…请重启后端再试试', tone: 'error', ttl: 0, priority: 4 });
    }
  }, [connection, starting, bubbles, startBackend]);

  // ---- hit testing & click-through ----
  useEffect(loadMasks, []);
  const interactive = useRef(false);
  const setInteractive = useCallback((on: boolean) => {
    if (interactive.current === on) return;
    interactive.current = on;
    host.pet.setInteractive(on);
  }, [host]);

  const spriteUV = useCallback((clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return null;
    let u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    if (flip) u = 1 - u;
    return { u, v };
  }, [flip]);
  const overSprite = useCallback((clientX: number, clientY: number) => {
    const uv = spriteUV(clientX, clientY);
    return !!uv && hitSprite(view, uv.u, uv.v);
  }, [spriteUV, view]);

  const hoverTimer = useRef<number | undefined>(undefined);
  const setHover = useCallback((on: boolean) => {
    window.clearTimeout(hoverTimer.current);
    if (on) setHovered(true);
    else hoverTimer.current = window.setTimeout(() => setHovered(false), 650);
  }, []);

  const pat = useRef({ lastX: 0, dir: 0, flips: [] as number[] });
  const drag = useRef<null | { sx: number; sy: number; b?: { x: number; y: number }; moved: boolean; lx: number; lt: number }>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drag.current) return;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-hit]');
      const kind = target?.dataset.hit;
      const onSprite = kind === 'sprite' && overSprite(e.clientX, e.clientY);
      setInteractive(onSprite || (!!kind && kind !== 'sprite'));
      if (onSprite || kind === 'dock') setHover(true); else setHover(false);
      if (onSprite && kind === 'sprite' && e.buttons === 0) {
        // Rubbing back and forth over the head counts as a pat.
        const uv = spriteUV(e.clientX, e.clientY);
        const p = pat.current;
        if (uv && uv.v < 0.36) {
          const dx = e.clientX - p.lastX;
          const dir = Math.sign(dx);
          if (dir && Math.abs(dx) > 1 && dir !== p.dir) {
            const now = performance.now();
            p.flips = [...p.flips.filter(t => now - t < 1400), now];
            p.dir = dir;
            if (p.flips.length >= 5) {
              p.flips = [];
              wake();
              burst('heart', 5, 0.5, 0.05, 60);
              setBlush(true); window.setTimeout(() => setBlush(false), 2600);
              squash(0.5);
              bubbles.say({ text: line.pat(), tone: 'happy', ttl: 2800, priority: 1 });
            }
          }
        }
        p.lastX = e.clientX;
      }
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [overSprite, spriteUV, setInteractive, setHover, wake, burst, squash, bubbles]);

  // The cursor outside the window: stop capturing, and lean toward it when it's near.
  const moodRef = useRef(mood);
  moodRef.current = mood;
  useEffect(() => host.pet.onCursor(point => {
    const inside = point.x >= 0 && point.y >= 0 && point.x < PET_WINDOW.width && point.y < PET_WINDOW.height;
    if (!inside && !drag.current) { setInteractive(false); setHover(false); }
    if (drag.current) return;
    const m = moodRef.current;
    if (m !== 'idle' && m !== 'waiting' && m !== 'thinking' && m !== 'offline') { leanTarget.set(0); return; }
    const dx = point.x - PET_WINDOW.width / 2;
    const dy = point.y - (boxTop + boxH * 0.4);
    const near = Math.hypot(dx, dy) < 520;
    leanTarget.set(near ? clamp(dx / 70, -4.5, 4.5) : 0);
  }), [host, setInteractive, setHover, leanTarget, boxTop, boxH]);

  // ---- dragging & clicking ----
  const pokes = useRef<number[]>([]);
  const poke = useCallback(() => {
    wake();
    const now = Date.now();
    pokes.current = [...pokes.current.filter(t => now - t < 4000), now];
    const annoyed = pokes.current.length >= 4;
    squash(annoyed ? 1.3 : 1);
    if (annoyed) { pokes.current = []; burst('sweat', 1, 0.74, 0.12); }
    else if (Math.random() < 0.35) burst('note', 2, 0.62, 0.1, 40);
    bubbles.say({ text: annoyed ? line.annoyed() : line.poke(), ttl: 2600, priority: 1 });
  }, [wake, squash, burst, bubbles]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !overSprite(e.clientX, e.clientY)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const state: NonNullable<typeof drag.current> = { sx: e.screenX, sy: e.screenY, moved: false, lx: e.screenX, lt: performance.now() };
    drag.current = state;
    void host.pet.bounds().then(b => { state.b = b; });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.screenX - d.sx, dy = e.screenY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      wake();
      setDragging(true);
      stopWalk.current?.();
      bubbles.say({ text: line.drag(), ttl: 1800, priority: 1 });
    }
    if (d.b) host.pet.moveTo(d.b.x + dx, d.b.y + dy);
    const now = performance.now();
    const vx = (e.screenX - d.lx) / Math.max(8, now - d.lt);
    d.lx = e.screenX; d.lt = now;
    leanTarget.set(clamp(-vx * 16, -26, 26));
    if (Math.abs(vx) > 0.15) setDragFacing(vx > 0 ? 'right' : 'left');
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      host.pet.moveEnd();
      setDragging(false);
      leanTarget.set(0);
      squash(1.2);
      if (Math.random() < 0.5) bubbles.say({ text: line.drop(), ttl: 2200, priority: 0 });
    } else {
      poke();
    }
  };

  // ---- strolling ----
  const stopWalk = useRef<(() => void) | null>(null);
  const canWalk = prefs.walk && !prefs.focus && !forcedMood && base === 'idle' && !transient && !dragging && !panelVisible && !hovered && !sleeping && pageVisible;
  useEffect(() => {
    if (!canWalk) return;
    let cancelled = false;
    let frame = 0;
    let timer = 0;
    const schedule = () => { timer = window.setTimeout(start, rand(20_000, 45_000)); };
    const start = async () => {
      const [b, area] = await Promise.all([host.pet.bounds(), host.pet.workArea()]);
      if (cancelled) return;
      const minX = area.x - 60, maxX = area.x + area.width - b.width + 60;
      let distance = rand(120, 380) * (Math.random() < 0.5 ? -1 : 1);
      if (b.x + distance < minX || b.x + distance > maxX) distance = -distance;
      const target = clamp(b.x + distance, minX, maxX);
      if (Math.abs(target - b.x) < 60) { schedule(); return; }
      setWalking(target > b.x ? 'right' : 'left');
      const duration = Math.abs(target - b.x) / 58 * 1000;
      const t0 = performance.now();
      const step = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - t0) / duration);
        const eased = t < 0.1 ? t * t * 5 : t > 0.9 ? 1 - (1 - t) * (1 - t) * 5 : t; // gentle start/stop
        host.pet.moveTo(b.x + (target - b.x) * clamp(eased, 0, 1), b.y);
        if (t < 1) frame = requestAnimationFrame(step);
        else { host.pet.moveEnd(); setWalking(null); schedule(); }
      };
      frame = requestAnimationFrame(step);
    };
    stopWalk.current = () => { if (frame) { cancelled = true; cancelAnimationFrame(frame); host.pet.moveEnd(); setWalking(null); } };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (frame) { cancelAnimationFrame(frame); host.pet.moveEnd(); }
      setWalking(null);
      stopWalk.current = null;
    };
  }, [canWalk, host]);

  // Occasionally glance toward a cursor that lingers to one side.
  useEffect(() => {
    if (mood !== 'idle') return;
    let last = 0;
    let timer = 0;
    const off = host.pet.onCursor(point => {
      window.clearTimeout(timer);
      const dx = point.x - PET_WINDOW.width / 2;
      if (Math.abs(dx) < 150 || Math.abs(dx) > 700 || Date.now() - last < 9000) return;
      timer = window.setTimeout(() => {
        last = Date.now();
        setGlance(dx > 0 ? 'right' : 'left');
        window.setTimeout(() => setGlance(null), 1800);
      }, 1200);
    });
    return () => { off(); window.clearTimeout(timer); };
  }, [mood, host]);

  // ---- status pill ----
  const pill = mood === 'offline' ? { tone: 'warn', text: connection === 'unauthorized' ? '令牌无效' : '后端未连接' }
    : busy ? { tone: 'think', text: progress ? excerpt(progress, 16) : '思考中' }
    : running.length ? { tone: 'work', text: running.length > 1 ? `${running.length} 个任务进行中` : excerpt(running[0].title, 14) }
    : queued.length ? { tone: 'wait', text: `${queued.length} 个任务排队中` }
    : null;

  const showDock = (hovered || dockHover) && !dragging && !walking;
  const sprite = SPRITES[view];

  return (
    <div className={`pet-root ${pageVisible ? '' : 'paused'}`} style={{ width: PET_WINDOW.width, height: PET_WINDOW.height }}
      onContextMenu={e => { e.preventDefault(); if (overSprite(e.clientX, e.clientY)) host.pet.menu(); }}>
      {/* screen glow while she works facing the desktop */}
      <AnimatePresence>
        {mood === 'working' && (
          <motion.div className="work-glow" style={{ left: boxLeft + boxW * 0.5, top: boxTop + boxH * 0.42 }}
            initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} />
        )}
      </AnimatePresence>

      <motion.div className="pet-shadow" style={{ left: boxLeft + boxW * 0.2, width: boxW * 0.6, bottom: FLOOR - 9, scale: shadowScale, opacity: shadowOpacity }} />

      <motion.div className="pet-body" style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH, y: jumpY, rotate: lean }}>
        <div ref={squashRef} className="pet-squash">
          <div className={`pet-mood mood-${mood}`}>
            <motion.div className="pet-flip" animate={{ scaleX: flip ? -1 : 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
              <div ref={frameRef} data-hit="sprite" className="sprite-frame" style={{ width: sprite.width * scale, height: boxH }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                onDoubleClick={e => { if (overSprite(e.clientX, e.clientY)) openPanel('chat'); }}>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.img key={view} src={sprite.src} className="sprite" draggable={false} alt="大肥鱼"
                    initial={{ opacity: 0, scaleX: 0.55 }} animate={{ opacity: 1, scaleX: 1 }}
                    exit={{ opacity: 0, scaleX: 0.55, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.2, ease: [0.2, 0.8, 0.3, 1] }} />
                </AnimatePresence>
              </div>
            </motion.div>

            {/* front-view blush when patted or hovered for a while */}
            <AnimatePresence>
              {view === 'front' && (blush || mood === 'celebrate') && (
                <motion.div className="blush-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
                  <span style={{ left: '37%', top: '51.5%' }} />
                  <span style={{ left: '64%', top: '51.5%' }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* thought dots / question mark ride with the head */}
        <AnimatePresence>
          {mood === 'thinking' && (
            <motion.div key="think" className="thought" style={{ left: '76%', top: '-2%' }}
              initial={{ opacity: 0, scale: 0.4, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
              <i /><i /><i />
            </motion.div>
          )}
          {(mood === 'waiting' || mood === 'offline') && (
            <motion.div key="wait" className={`mark ${mood}`} style={{ left: '72%', top: '-4%' }}
              initial={{ opacity: 0, scale: 0.2, rotate: -30 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
              {mood === 'offline' ? '!' : '?'}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <Effects ref={effects} />

      <SpeechBubble bubble={bubbles.current} bottom={FLOOR + boxH + 8} onHover={bubbles.hover}
        onClick={() => { if (!bubbles.current?.actions?.length) bubbles.dismiss(); }} />

      <AnimatePresence>
        {pill && !dragging && (
          <motion.div key="pill" className={`status-pill ${pill.tone}`} data-hit="pill" onClick={() => openPanel(pill.tone === 'think' ? 'chat' : pill.tone === 'warn' ? 'chat' : 'tasks')}
            initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 460, damping: 30 }}>
            <span className="pill-dot" />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={pill.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {pill.text}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDock && (
          <motion.div className="dock" data-hit="dock" style={{ left: Math.max(6, boxLeft - 46), top: boxTop + boxH * 0.3 }}
            onPointerEnter={() => setDockHover(true)} onPointerLeave={() => setDockHover(false)}
            initial="hidden" animate="shown" exit="hidden"
            variants={{ shown: { transition: { staggerChildren: 0.05 } }, hidden: { transition: { staggerChildren: 0.03, staggerDirection: -1 } } }}>
            {([
              ['chat', '聊天', IconChat, () => openPanel('chat')],
              ['tasks', '任务', IconTasks, () => openPanel('tasks')],
              ['more', '更多', IconMore, () => host.pet.menu()],
            ] as const).map(([key, label, Icon, run]) => (
              <motion.button key={key} data-hit="dock" className="dock-btn" title={label} aria-label={label} onClick={run}
                variants={{ hidden: { opacity: 0, x: 14, scale: 0.6 }, shown: { opacity: 1, x: 0, scale: 1 } }}
                transition={{ type: 'spring', stiffness: 520, damping: 26 }}
                whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                <Icon size={17} />
                {key === 'tasks' && running.length + queued.length > 0 && <b className="dock-badge">{running.length + queued.length}</b>}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
