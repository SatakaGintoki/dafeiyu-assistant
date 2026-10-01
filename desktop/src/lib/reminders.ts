import type { AgendaNotification } from '../../../shared/agenda';

/** id → the last state we acted on. A notification pops again only after going snoozed → pending. */
export type ShownLog = Record<string, 'pending' | 'snoozed'>;

const MAX_POPUPS = 3;

/**
 * Decides which reminders to pop now. `notifications` must come from a fresh snapshot (pending/snoozed only),
 * so cancelled or already-handled events replayed over SSE never surface.
 * Content edits (title, revision) don't re-pop; ids missing from the snapshot are forgotten.
 */
export function deliverReminders(notifications: AgendaNotification[], log: ShownLog, quiet: boolean) {
  const next: ShownLog = {};
  const show: AgendaNotification[] = [];
  for (const n of [...notifications].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    if (n.status === 'snoozed') { next[n.id] = 'snoozed'; continue; }
    if (n.status !== 'pending') continue;
    if (log[n.id] === 'pending') { next[n.id] = 'pending'; continue; }
    // During quiet hours leave it unrecorded so it pops once they end; previous state is kept.
    if (quiet) { if (log[n.id]) next[n.id] = log[n.id]; continue; }
    next[n.id] = 'pending';
    show.push(n);
  }
  return { show: show.slice(-MAX_POPUPS), overflow: Math.max(0, show.length - MAX_POPUPS), log: next };
}
