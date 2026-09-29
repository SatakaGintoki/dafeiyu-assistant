import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'info' | 'success' | 'error';
interface Toast { id: number; text: string; tone: Tone }
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

let ids = 1;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = ids++;
    setToasts(list => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), tone === 'error' ? 5000 : 2800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} layout className={`toast ${t.tone}`}
              initial={{ opacity: 0, y: 18, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
