import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { AgendaNotification } from '../../../../shared/agenda';
import { useApp } from '../../context';

/**
 * Browser preview stand-in for OS notifications: a short-lived popup over the fake desktop.
 * The persistent inbox in the agenda tab stays the source of truth; closing a popup doesn't acknowledge anything.
 */
export function WebReminderPopups() {
  const { agenda, host } = useApp();
  const [list, setList] = useState<{ n: AgendaNotification; overflow: number }[]>([]);
  useEffect(() => agenda.onReminders((shown, overflow) => {
    setList(old => [...old, ...shown.map((n, i) => ({ n, overflow: i === shown.length - 1 ? overflow : 0 }))].slice(-3));
  }), [agenda]);
  const close = (id: string) => setList(old => old.filter(x => x.n.id !== id));
  return (
    <div className="web-reminders" role="status" aria-live="polite">
      <AnimatePresence>
        {list.map(({ n, overflow }) => (
          <motion.div key={n.id} className="web-reminder" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}>
            <small>大肥鱼提醒（应用内）</small>
            <b>{n.title}</b>
            {overflow > 0 && <small>还有 {overflow} 条提醒</small>}
            <div>
              <button className="btn ghost" onClick={() => close(n.id)}>关闭</button>
              <button className="btn primary" onClick={() => { close(n.id); host.reminders.focus(n.id); }}>查看</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
