import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SseClient } from '../src/lib/sse';
import { Store } from '../src/lib/store';
import type { Connection, StreamItem, Transport } from '../src/lib/types';

async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail('Timed out waiting for connection state');
}

test('SSE starts once, decodes split Chinese frames and resumes with fresh URL and credentials', async () => {
  const events: StreamItem[] = [];
  const requests: { url: string; headers: Headers }[] = [];
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let url = 'http://localhost:4318/events';
  let token = 'first';
  const client = new SseClient({
    url: () => url, headers: () => ({ Authorization: token }), emit: item => events.push(item),
    fetch: (async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(new ReadableStream({
        start(controller) {
          stream = controller;
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      }));
    }) as typeof fetch,
  });
  try {
    client.start(); client.start();
    await until(() => client.connection === 'online');
    assert.equal(requests.length, 1);
    const event = { seq: 7, type: 'chat.progress', data: { text: '正在处理中文' }, at: 'now' };
    const bytes = new TextEncoder().encode(`: heartbeat\r\n\r\nevent: sync.required\r\ndata: {}\r\n\r\nid: 7\r\nevent: chat.progress\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
    for (const byte of bytes) stream.enqueue(new Uint8Array([byte]));
    await until(() => events.some(item => item.kind === 'event'));
    assert.deepEqual(events.find(item => item.kind === 'event'), { kind: 'event', event });
    assert.ok(events.some(item => item.kind === 'sync'));
    url = 'http://localhost:4319/events'; token = 'rotated';
    stream.close();
    await until(() => requests.length === 2);
    assert.equal(requests[1].url, url);
    assert.equal(requests[1].headers.get('Authorization'), token);
    assert.equal(requests[1].headers.get('Last-Event-ID'), '7');
  } finally { client.stop(); }
});

test('stopping an unauthorized stream cancels its pending retry', async () => {
  let calls = 0;
  const client = new SseClient({ url: '/events', headers: () => ({}), emit() {},
    fetch: (async () => { calls++; return new Response(null, { status: 401 }); }) as typeof fetch });
  client.start();
  await until(() => client.connection === 'unauthorized');
  client.stop();
  await delay(30);
  assert.equal(calls, 1);
});

test('late initial connection response cannot overwrite a live connection event', async () => {
  let receive!: (item: StreamItem) => void;
  let initial!: (status: Connection) => void;
  const transport: Transport = {
    subscribe(listener) { receive = listener; return () => {}; },
    connection: () => new Promise(resolve => { initial = resolve; }),
    request: async () => ({ status: 503, body: {} }),
  };
  const store = new Store(transport);
  receive({ kind: 'connection', status: 'online' });
  initial('offline');
  await delay(0);
  assert.equal(store.get().connection, 'online');
});

test('failed initial connection lookup becomes offline and later stream events recover', async () => {
  let receive!: (item: StreamItem) => void;
  const store = new Store({
    subscribe(listener) { receive = listener; return () => {}; },
    connection: async () => { throw new Error('IPC unavailable'); },
    request: async () => ({ status: 503, body: {} }),
  });
  await delay(0);
  assert.equal(store.get().connection, 'offline');
  receive({ kind: 'connection', status: 'online' });
  assert.equal(store.get().connection, 'online');
});
