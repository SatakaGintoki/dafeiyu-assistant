import { Notification } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import type { AgendaSnapshot } from '../../shared/agenda';
import type { NotifierStatus } from '../src/lib/host';
import { formatInstant, inQuietHours } from '../src/lib/agendaTime';
import { deliverReminders, type ShownLog } from '../src/lib/reminders';
import type { ApiResponse, StreamItem } from '../src/lib/types';

interface Options {
  request(method: string, path: string): Promise<ApiResponse>;
  logFile: string;
  onClick(notificationId: string): void;
  onStatus(status: NotifierStatus): void;
}

/**
 * The single owner of OS notifications. Both renderer windows only show the in-app inbox,
 * so reconnects or recreated windows can't pop the same reminder twice.
 * Every check starts from a fresh snapshot: SSE replays of reminders that were since completed,
 * rescheduled or acknowledged are never shown.
 */
export class ReminderNotifier {
  private log: ShownLog = {};
  private status: NotifierStatus = { supported: Notification.isSupported(), shown: 0 };
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private checking = false;
  private again = false;
  // Keep references so toasts stay clickable and can be withdrawn once handled elsewhere.
  private live = new Map<string, Notification>();

  constructor(private options: Options) {
    try { this.log = JSON.parse(readFileSync(options.logFile, 'utf8')); } catch { /* first run */ }
    if (!this.status.supported) this.status.error = '当前系统不支持桌面通知，提醒只显示在面板里';
  }

  current() { return this.status; }

  start() {
    // Quiet hours can end without any backend event; a slow poll picks up reminders held back meanwhile.
    this.interval ??= setInterval(() => this.schedule(), 60_000);
    this.schedule();
  }
  stop() { clearInterval(this.interval); this.interval = undefined; clearTimeout(this.timer); }

  handle(item: StreamItem) {
    if (item.kind === 'sync' || (item.kind === 'connection' && item.status === 'online')) this.schedule();
    else if (item.kind === 'event' && (item.event.type === 'agenda.reminder' || item.event.type === 'agenda.changed')) this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), 150);
  }

  private setStatus(patch: Partial<NotifierStatus>) {
    this.status = { ...this.status, ...patch };
    this.options.onStatus(this.status);
  }

  async check() {
    if (this.checking) { this.again = true; return; }
    this.checking = true;
    try {
      const response = await this.options.request('GET', '/api/v1/agenda');
      // Offline or unauthorized: the panel already explains it; nothing can be delivered right now.
      if (response.status !== 200) return;
      const snapshot = response.body as AgendaSnapshot;
      const result = deliverReminders(snapshot.notifications, this.log, inQuietHours(snapshot.preferences));
      this.log = result.log;
      try { writeFileSync(this.options.logFile, JSON.stringify(this.log)); } catch { /* non-fatal; worst case a repeat popup after restart */ }
      for (const [id, toast] of this.live) if (!snapshot.notifications.some(n => n.id === id && n.status === 'pending')) { toast.close(); this.live.delete(id); }
      if (this.status.supported) {
        for (const n of result.show) {
          const item = snapshot.items.find(i => i.id === n.itemId);
          const tz = item?.timezone || snapshot.preferences.timezone;
          const when = n.occurrenceAt || item?.dueAt || n.scheduledAt;
          this.show(n.id, n.title, `${n.occurrenceAt ? '开始' : item?.dueAt ? '截止' : '提醒'}：${formatInstant(when, tz, snapshot.preferences.timezone)}`);
        }
        if (result.overflow) this.show('', `还有 ${result.overflow} 条提醒`, '打开事务本查看全部');
      }
      this.setStatus({ checkedAt: new Date().toISOString() });
    } catch {
      /* backend unreachable; next event or poll retries */
    } finally {
      this.checking = false;
      if (this.again) { this.again = false; this.schedule(); }
    }
  }

  private show(id: string, title: string, body: string) {
    try {
      const toast = new Notification({ title: `大肥鱼提醒 · ${title}`, body });
      toast.on('click', () => this.options.onClick(id));
      toast.on('failed', (_event, error) => this.setStatus({ error: `系统通知发送失败：${error}。请检查 Windows“设置 > 系统 > 通知”是否允许大肥鱼管家` }));
      toast.on('close', () => { if (this.live.get(id) === toast) this.live.delete(id); });
      if (id) { this.live.get(id)?.close(); this.live.set(id, toast); }
      toast.show();
      this.setStatus({ shown: this.status.shown + 1, error: undefined });
    } catch (error) {
      this.setStatus({ error: `系统通知发送失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }
}
