import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface BubbleAction { label: string; run: () => void; primary?: boolean }
export interface BubbleData {
  id?: string;
  text: string;
  tone?: 'normal' | 'happy' | 'warn' | 'error';
  actions?: BubbleAction[];
  /** ms before auto-dismiss; 0 keeps it until dismissed. */
  ttl?: number;
  /** Higher interrupts lower; equal replaces. */
  priority?: number;
}
type Shown = BubbleData & { key: number };

let keys = 1;

/** One bubble at a time; lower-priority lines wait their turn, hover pauses the timer. */
export function useBubbles() {
  const [current, setCurrent] = useState<Shown | null>(null);
  const queue = useRef<Shown[]>([]);
  const hovered = useRef(false);
  const currentRef = useRef<Shown | null>(null);
  currentRef.current = current;

  const next = useCallback(() => setCurrent(queue.current.shift() ?? null), []);

  const say = useCallback((bubble: BubbleData) => {
    const shown: Shown = { ttl: 4200, priority: 1, tone: 'normal', ...bubble, key: keys++ };
    const now = currentRef.current;
    if (shown.id) queue.current = queue.current.filter(b => b.id !== shown.id);
    if (!now || (shown.priority ?? 1) >= (now.priority ?? 1) || (shown.id && shown.id === now.id)) {
      // A sticky bubble that gets interrupted comes back afterwards.
      if (now && now.ttl === 0 && now.id !== shown.id) queue.current.unshift(now);
      setCurrent(shown);
    } else {
      queue.current = [...queue.current.filter(b => b.priority! >= 1), shown].slice(-3);
    }
  }, []);

  const dismiss = useCallback((id?: string) => {
    if (id) queue.current = queue.current.filter(b => b.id !== id);
    if (!id || currentRef.current?.id === id) next();
  }, [next]);

  const timer = useRef<number | undefined>(undefined);
  const arm = useCallback((ms?: number) => {
    window.clearTimeout(timer.current);
    const b = currentRef.current;
    if (!b || !b.ttl || hovered.current) return;
    timer.current = window.setTimeout(next, ms ?? b.ttl);
  }, [next]);
  useEffect(() => { arm(); return () => window.clearTimeout(timer.current); }, [current, arm]);

  const hover = useCallback((on: boolean) => {
    hovered.current = on;
    if (on) window.clearTimeout(timer.current); else arm(2200);
  }, [arm]);

  return { current, say, dismiss, hover };
}

export function SpeechBubble({ bubble, bottom, onHover, onClick }: {
  bubble: Shown | null; bottom: number; onHover: (on: boolean) => void; onClick: () => void;
}) {
  return (
    <div className="bubble-anchor" style={{ bottom }}>
      <AnimatePresence mode="popLayout">
        {bubble && (
          <motion.div key={bubble.key} data-hit="bubble" className={`speech tone-${bubble.tone}`}
            initial={{ opacity: 0, scale: 0.55, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 6, transition: { duration: 0.16, ease: 'easeIn' } }}
            transition={{ type: 'spring', stiffness: 520, damping: 26, mass: 0.7 }}
            onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}
            onClick={onClick}>
            <p>{bubble.text}</p>
            {!!bubble.actions?.length && (
              <div className="speech-actions">
                {bubble.actions.map(a => (
                  <button key={a.label} className={a.primary ? 'primary' : ''}
                    onClick={event => { event.stopPropagation(); a.run(); }}>{a.label}</button>
                ))}
              </div>
            )}
            <svg className="speech-tail" width="22" height="12" viewBox="0 0 22 12" aria-hidden>
              <path d="M0 0 H22 C15 1 12 5 11 12 C10 5 7 1 0 0Z" />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
