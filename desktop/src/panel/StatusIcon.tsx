import { motion } from 'motion/react';
import type { TaskStatus } from '../lib/types';

export const statusLabel: Record<TaskStatus, string> = {
  queued: '排队中', running: '进行中', cancelling: '取消中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
};

/** Animated status glyph: spinning ring, drawn check, drawn cross. */
export function StatusIcon({ status, size = 18 }: { status: TaskStatus; size?: number }) {
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.45, ease: 'easeOut' as const } };
  return (
    <span className={`status-icon s-${status}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-label={statusLabel[status]}>
        {(status === 'running' || status === 'cancelling') && (
          <>
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.2" />
            <path className="spin" d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" stroke="currentColor" strokeWidth="2.2" />
          </>
        )}
        {status === 'queued' && (
          <>
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.6 2.6" className="spin-slow" />
            <path d="M10 6.5V10l2.2 1.6" stroke="currentColor" strokeWidth="1.8" />
          </>
        )}
        {status === 'succeeded' && (
          <>
            <circle cx="10" cy="10" r="8.5" fill="currentColor" />
            <motion.path d="m6.2 10.3 2.6 2.6 5-5.4" stroke="#fff" strokeWidth="2.2" {...draw} />
          </>
        )}
        {(status === 'failed' || status === 'interrupted') && (
          <>
            <circle cx="10" cy="10" r="8.5" fill="currentColor" />
            {status === 'failed'
              ? <motion.path d="M7 7l6 6M13 7l-6 6" stroke="#fff" strokeWidth="2.2" {...draw} />
              : <motion.path d="M10 5.8v5M10 14h.01" stroke="#fff" strokeWidth="2.4" {...draw} />}
          </>
        )}
        {status === 'cancelled' && (
          <>
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M6.5 13.5l7-7" stroke="currentColor" strokeWidth="1.8" />
          </>
        )}
      </svg>
    </span>
  );
}
