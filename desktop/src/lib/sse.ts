import type { AppEvent, Connection, StreamItem } from './types';

export interface SseOptions {
  url: string | (() => string);
  headers: () => Record<string, string>;
  emit: (item: StreamItem) => void;
  fetch?: typeof fetch;
}

/**
 * Authenticated SSE over fetch (EventSource cannot send Authorization).
 * First connection asks for no replay: the backend always follows with sync.required,
 * so the client takes a fresh snapshot instead of re-living old history.
 * Later reconnects resume from the last seen id.
 */
export class SseClient {
  private lastId = Number.MAX_SAFE_INTEGER;
  private controller?: AbortController;
  private stopped = false;
  private status: Connection = 'connecting';
  private retry = 1000;
  private running?: Promise<void>;

  constructor(private options: SseOptions) {}

  get connection() { return this.status; }

  start() {
    if (this.running) return;
    this.stopped = false;
    this.running = this.loop().finally(() => { this.running = undefined; });
  }
  stop() { this.stopped = true; this.controller?.abort(); }

  private setStatus(status: Connection) {
    if (status === this.status) return;
    this.status = status;
    this.options.emit({ kind: 'connection', status });
  }

  private async loop() {
    const fetcher = this.options.fetch ?? fetch;
    while (!this.stopped) {
      this.controller = new AbortController();
      try {
        const url = typeof this.options.url === 'function' ? this.options.url() : this.options.url;
        const response = await fetcher(url, {
          headers: { ...this.options.headers(), Accept: 'text/event-stream', 'Last-Event-ID': String(this.lastId) },
          signal: this.controller.signal,
        });
        if (response.status === 401) { this.setStatus('unauthorized'); await this.wait(5000); continue; }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        this.setStatus('online');
        this.retry = 1000;
        await this.read(response.body);
      } catch {
        if (this.stopped) return;
      }
      if (this.stopped) return;
      this.setStatus('offline');
      await this.wait(this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    }
  }

  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let carry = ''; // a trailing \r may be the first half of \r\n
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      let text = carry + decoder.decode(value, { stream: true });
      carry = text.endsWith('\r') ? '\r' : '';
      if (carry) text = text.slice(0, -1);
      buffer += text.replace(/\r\n?/g, '\n');
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        this.dispatch(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
  }

  private dispatch(block: string) {
    let type = 'message', data = '', id: string | undefined;
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') type = value;
      else if (field === 'data') data += (data ? '\n' : '') + value;
      else if (field === 'id') id = value;
    }
    if (type === 'sync.required') { this.options.emit({ kind: 'sync' }); return; }
    if (!data) return;
    try {
      const event = JSON.parse(data) as AppEvent;
      if (id && Number.isSafeInteger(Number(id))) this.lastId = Number(id);
      this.options.emit({ kind: 'event', event });
    } catch { /* ignore malformed frames */ }
  }

  private wait(ms: number) {
    return new Promise<void>(resolve => {
      const signal = this.controller?.signal;
      if (this.stopped || signal?.aborted) { resolve(); return; }
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
