import assert from 'node:assert/strict';
import { StringDecoder } from 'node:string_decoder';
import { test } from 'node:test';

import { JsonLineDecoder, normalizeEvent, type ExecutionUpdate } from '../server/executor-events.ts';

/** Minimal harness: collect every normalized update plus every text line. */
function collector(executor: 'codex' | 'claude') {
  const updates: ExecutionUpdate[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(normalizeEvent(executor, value)),
    (line) => texts.push(line),
  );
  return { updates, texts, decoder };
}

test('decoder: byte limit counts Chinese text as UTF-8 bytes',()=>{
  const values:unknown[]=[],warnings:string[]=[];
  const decoder=new JsonLineDecoder(v=>values.push(v),s=>warnings.push(s),8);
  decoder.push('"中文鱼"\n1\n');decoder.end();
  assert.deepEqual(values,[1]);assert.equal(warnings.length,1);
});

test('claude: bare result envelope cannot mark a task successful',()=>{
  assert.deepEqual(normalizeEvent('claude',{type:'result'}),{});
});

/** normalizeEvent must never throw; fail loudly here if it ever does. */
function safeNormalize(executor: 'codex' | 'claude', event: unknown): ExecutionUpdate {
  try {
    return normalizeEvent(executor, event);
  } catch (error) {
    assert.fail(`normalizeEvent(${executor}, ...) threw: ${String(error)}`);
  }
}

/* ------------------------------------------------------------------ */
/* codex                                                               */
/* ------------------------------------------------------------------ */

test('codex: thread.started yields sessionId', () => {
  assert.deepEqual(normalizeEvent('codex', { type: 'thread.started', thread_id: 't-1' }), {
    sessionId: 't-1',
  });
  assert.deepEqual(normalizeEvent('codex', { type: 'thread.started' }), {});
});

test('codex: completed agent_message is a result, not completion', () => {
  const update = normalizeEvent('codex', {
    type: 'item.completed',
    item: { id: 'i1', type: 'agent_message', text: 'here is the answer' },
  });
  assert.equal(update.completed, undefined);
  assert.deepEqual(update, { result: 'here is the answer' });
});

test('codex: started agent_message is ignored (no answer yet)', () => {
  assert.deepEqual(
    normalizeEvent('codex', {
      type: 'item.started',
      item: { type: 'agent_message', text: 'partial' },
    }),
    {},
  );
});

test('codex: command_execution logs the command and output', () => {
  const started = normalizeEvent('codex', {
    type: 'item.started',
    item: { type: 'command_execution', command: 'ls -la' },
  });
  assert.equal(started.log, '$ ls -la');

  const done = normalizeEvent('codex', {
    type: 'item.completed',
    item: {
      type: 'command_execution',
      command: 'ls -la',
      aggregated_output: 'a.txt\nb.txt\n',
      exit_code: 0,
    },
  });
  assert.equal(done.log, '$ ls -la\na.txt\nb.txt');
  assert.equal(done.completed, undefined);
});

test('codex: non-zero exit code is surfaced in the log', () => {
  const update = normalizeEvent('codex', {
    type: 'item.completed',
    item: { type: 'command_execution', command: 'false', aggregated_output: '', exit_code: 1 },
  });
  assert.equal(update.log, '$ false\n[exit code 1]');
});

test('codex: aggregated output is bounded', () => {
  const update = normalizeEvent('codex', {
    type: 'item.completed',
    item: { type: 'command_execution', command: 'cat big', aggregated_output: 'x'.repeat(20_000) },
  });
  assert.ok(update.log);
  assert.ok(update.log.length < 5_000, 'log should be truncated');
  assert.match(update.log, /truncated \d+ chars/);
});

test('codex: turn.completed marks completion', () => {
  assert.deepEqual(normalizeEvent('codex', { type: 'turn.completed', usage: {} }), {
    completed: true,
  });
});

test('codex: failures come from turn.failed and top-level error', () => {
  assert.deepEqual(
    normalizeEvent('codex', { type: 'turn.failed', error: { message: 'boom' } }),
    { error: 'boom' },
  );
  assert.deepEqual(normalizeEvent('codex', { type: 'error', message: 'stream broke' }), {
    error: 'stream broke',
  });
  assert.deepEqual(normalizeEvent('codex', { type: 'turn.failed' }), {
    error: 'codex turn failed',
  });
});

test('codex: a failed turn is an error even though its commands exited 0', () => {
  const { updates, decoder } = collector('codex');
  decoder.push(
    `${JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'node run.js',
        aggregated_output: '',
        exit_code: 0,
      },
    })}\n${JSON.stringify({ type: 'turn.failed', error: { message: 'model stopped early' } })}\n`,
  );
  decoder.end();

  assert.equal(updates.length, 2);
  assert.equal(updates[1]?.completed, undefined);
  assert.deepEqual(updates[1], { error: 'model stopped early' });
});

/* ------------------------------------------------------------------ */
/* claude                                                              */
/* ------------------------------------------------------------------ */

test('claude: init exposes session_id', () => {
  assert.deepEqual(
    normalizeEvent('claude', { type: 'system', subtype: 'init', session_id: 's-9' }),
    { sessionId: 's-9' },
  );
});

test('claude: assistant text blocks become log lines, tool_use is ignored', () => {
  const update = normalizeEvent('claude', {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'first part' },
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
        { type: 'text', text: 'second part' },
      ],
    },
  });
  assert.equal(update.log, 'first part\nsecond part');
  assert.equal(update.result, undefined);
});

test('claude: assistant message without text produces nothing', () => {
  assert.deepEqual(
    normalizeEvent('claude', {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash' }] },
    }),
    {},
  );
});

test('claude: successful result is the final result and completes the run', () => {
  const update = normalizeEvent('claude', {
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 's-1',
    result: 'all done',
    permission_denials: [],
  });
  assert.deepEqual(update, { sessionId: 's-1', result: 'all done', completed: true });
});

test('claude: user tool results never become the final result', () => {
  assert.deepEqual(
    normalizeEvent('claude', {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'file list' }] },
    }),
    {},
  );
});

test('claude: is_error result reports an error and never completes', () => {
  const update = normalizeEvent('claude', {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'the model gave up',
  });
  assert.deepEqual(update, { error: 'the model gave up' });
});

test('claude: error result falls back to the errors array', () => {
  assert.deepEqual(
    normalizeEvent('claude', { type: 'result', is_error: true, errors: ['x failed', 'y failed'] }),
    { error: 'x failed; y failed' },
  );
  assert.deepEqual(normalizeEvent('claude', { type: 'result', is_error: true }), {
    error: 'Claude Code result failed (error)',
  });
});

test('claude: unsuccessful result is an error even when the process exited 0', () => {
  const update = normalizeEvent('claude', {
    type: 'result',
    subtype: 'error_max_turns',
    is_error: true,
    exit_code: 0,
    result: 'hit the turn limit',
  });
  assert.equal(update.completed, undefined);
  assert.equal(update.error, 'hit the turn limit');
});

test('claude: permission denials are flagged and are not success', () => {
  const update = normalizeEvent('claude', {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'finished anyway',
    exit_code: 0,
    permission_denials: [
      { tool_name: 'Bash', tool_use_id: 'tu1', tool_input: { command: 'rm -rf /' } },
      { tool_name: 'Edit', tool_use_id: 'tu2', tool_input: {} },
      { tool_name: 'Bash', tool_use_id: 'tu3', tool_input: { command: 'sudo x' } },
    ],
  });
  assert.equal(update.permissionDenied, true);
  assert.equal(update.completed, undefined);
  assert.equal(update.result, undefined);
  assert.match(update.error ?? '', /permission denied/i);
  assert.match(update.error ?? '', /Bash/);
  assert.match(update.error ?? '', /Edit/);
});

test('claude: denial without tool names still reports how many were denied', () => {
  const update = normalizeEvent('claude', {
    type: 'result',
    permission_denials: [{}, {}],
  });
  assert.equal(update.permissionDenied, true);
  assert.match(update.error ?? '', /2 tool request/);
});

/* ------------------------------------------------------------------ */
/* malformed input                                                     */
/* ------------------------------------------------------------------ */

test('normalizeEvent ignores shapes it does not recognize', () => {
  const values: unknown[] = [
    null,
    undefined,
    0,
    42,
    Number.NaN,
    true,
    false,
    '',
    'not an object',
    [],
    [1, 2, 3],
    {},
    { type: null },
    { type: 7 },
    { type: 'no-such-event' },
    { type: 'turn.started' },
    { type: 'thread.started' },
    { type: 'item.completed', item: 'not-an-item' },
    { type: 'item.completed', item: { type: 'agent_message', text: 12 } },
    { type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } },
    { type: 'assistant', message: { content: [null, 'x', { type: 'text' }] } },
    { type: 'user' },
    { type: 'system' },
    Object.create(null),
  ];

  for (const value of values) {
    assert.deepEqual(normalizeEvent('codex', value), {}, `codex: ${JSON.stringify(value)}`);
    assert.deepEqual(normalizeEvent('claude', value), {}, `claude: ${JSON.stringify(value)}`);
  }
});

test('normalizeEvent never throws and keeps field types sane', () => {
  const messy: unknown[] = [
    ...['codex', 'claude', 'demo', '', null, 3].map((type) => ({ type })),
    { type: 'item.completed', item: { type: 'command_execution', command: 1, aggregated_output: {} } },
    { type: 'item.completed', item: { type: 'command_execution', command: 'x', exit_code: 'nope' } },
    { type: 'turn.failed', error: { message: 5 } },
    { type: 'turn.failed', error: [] },
    { type: 'error', message: { nested: true } },
    { type: 'assistant', message: { content: 'plain text' } },
    { type: 'assistant', message: null },
    { type: 'result', permission_denials: 'nope' },
    { type: 'result', errors: { message: 'obj' } },
    { type: 'result', result: 99, session_id: 1 },
    { type: 'result', permission_denials: [null, 7, 'Bash'] },
    { type: 'result', is_error: 'yes' },
  ];

  for (const value of messy) {
    for (const executor of ['codex', 'claude'] as const) {
      const update = safeNormalize(executor, value);
      for (const key of ['log', 'result', 'error', 'sessionId'] as const) {
        const field = update[key];
        if (field !== undefined) assert.equal(typeof field, 'string', `${executor}.${key}`);
      }
      if (update.completed !== undefined) assert.equal(typeof update.completed, 'boolean');
      if (update.permissionDenied !== undefined) {
        assert.equal(typeof update.permissionDenied, 'boolean');
      }
    }
  }
});

test('normalizeEvent: string assistant content is logged, and a result without flags completes', () => {
  assert.deepEqual(
    normalizeEvent('claude', { type: 'assistant', message: { content: 'plain text' } }),
    { log: 'plain text' },
  );
  // A text result without optional status flags is accepted; an empty envelope is not.
  assert.deepEqual(normalizeEvent('claude', { type: 'result', result: 'valid output' }), { result: 'valid output', completed: true });
});

test('normalizeEvent tolerates an unexpected executor value at runtime', () => {
  assert.deepEqual(normalizeEvent('demo' as unknown as 'codex', { type: 'turn.completed' }), {});
});

/* ------------------------------------------------------------------ */
/* decoder                                                             */
/* ------------------------------------------------------------------ */

test('decoder: reassembles a JSON value split across chunks', () => {
  const { updates, decoder } = collector('codex');
  decoder.push('{"type":"item.comp');
  decoder.push('leted","item":{"type":"agent_message","text":"hi"}}');
  decoder.end();
  assert.deepEqual(updates, [{ result: 'hi' }]);
});

test('decoder: handles several lines per chunk, CRLF and empty lines', () => {
  const { updates, texts, decoder } = collector('codex');
  decoder.push('\n{"type":"thread.started","thread_id":"t"}\r\n\r\n');
  decoder.push('{"type":"turn.completed"}\n');
  decoder.end();
  assert.deepEqual(updates, [{ sessionId: 't' }, { completed: true }]);
  assert.deepEqual(texts, []);
});

test('decoder: non-JSON lines go to onText, valid scalars still reach onEvent', () => {
  const seen: unknown[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => seen.push(value),
    (line) => texts.push(line),
  );
  decoder.push('npm warn something\n');
  decoder.push('42\n');
  decoder.push('"a json string"\n');
  decoder.end();
  assert.deepEqual(texts, ['npm warn something']);
  assert.deepEqual(seen, [42, 'a json string']);
});

test('decoder: flushes a final line without a trailing newline', () => {
  const { updates, decoder } = collector('codex');
  decoder.push('{"type":"turn.completed"}');
  assert.deepEqual(updates, []);
  decoder.end();
  assert.deepEqual(updates, [{ completed: true }]);
  decoder.end(); // idempotent
  assert.deepEqual(updates, [{ completed: true }]);
});

test('decoder: split multi-byte characters survive StringDecoder boundaries', () => {
  const payload = JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: '完成 ✅ 你好 🎉 ünïcödé' },
  });
  const bytes = Buffer.from(`${payload}\n`, 'utf8');

  const updates: ExecutionUpdate[] = [];
  const decoder = new JsonLineDecoder((value) => updates.push(normalizeEvent('codex', value)), () => {});
  const strings = new StringDecoder('utf8');

  // Feed one byte at a time so every multi-byte sequence is split.
  for (let i = 0; i < bytes.length; i += 1) {
    decoder.push(strings.write(bytes.subarray(i, i + 1)));
  }
  decoder.push(strings.end());
  decoder.end();

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.result, '完成 ✅ 你好 🎉 ünïcödé');
});

test('decoder: a CRLF-split line is not corrupted when \\r lands in its own chunk', () => {
  const { updates, texts, decoder } = collector('claude');
  decoder.push('{"type":"system","subtype":"init","session_id":"s"}\r');
  decoder.push('\n');
  decoder.end();
  assert.deepEqual(updates, [{ sessionId: 's' }]);
  assert.deepEqual(texts, []);
});

test('decoder: an overlong line inside one chunk is dropped and warned about', () => {
  const updates: unknown[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(value),
    (line) => texts.push(line),
    64,
  );
  const huge = `{"type":"item.completed","padding":"${'x'.repeat(500)}"}`;
  decoder.push(`${huge}\n{"type":"turn.completed"}\n`);
  decoder.end();

  assert.deepEqual(updates, [{ type: 'turn.completed' }]);
  assert.equal(texts.length, 1);
  assert.match(texts[0] ?? '', /dropped an overlong line/);
  assert.ok((texts[0] ?? '').length < 200, 'warning must be bounded');
  assert.ok(!texts[0]?.includes('x'.repeat(10)), 'no payload leaks into the warning');
});

test('decoder: overlong line spanning chunks is dropped through its newline', () => {
  const updates: unknown[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(value),
    (line) => texts.push(line),
    64,
  );

  decoder.push('x'.repeat(40)); // buffered, under the cap
  decoder.push('y'.repeat(40)); // over the cap, no newline yet -> start dropping
  decoder.push('z'.repeat(10)); // still inside the discarded line
  assert.deepEqual(updates, []);
  assert.equal(texts.length, 1);

  decoder.push('\n{"type":"turn.completed"}\n'); // tail ends, next line is parsed
  decoder.end();

  assert.deepEqual(updates, [{ type: 'turn.completed' }]);
  assert.equal(texts.length, 1, 'one warning per overlong line');
  assert.ok(!texts.some((line) => line.includes('y'.repeat(5)) || line.includes('z'.repeat(5))));
});

test('decoder: a truncated tail is never parsed, even when it looks like JSON', () => {
  const updates: unknown[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(value),
    (line) => texts.push(line),
    64,
  );
  // First chunk is over the cap without a newline; the second chunk completes
  // what would have been a valid object, but it must be discarded whole.
  decoder.push(`{"type":"turn.completed","pad":"${'p'.repeat(40)}`);
  decoder.push('"}\n');
  decoder.push('{"type":"thread.started","thread_id":"after"}\n');
  decoder.end();

  assert.deepEqual(updates, [{ type: 'thread.started', thread_id: 'after' }]);
  assert.equal(texts.length, 1);
  assert.match(texts[0] ?? '', /dropped an overlong line/);
});

test('decoder: two overlong lines produce two warnings', () => {
  const texts: string[] = [];
  const updates: unknown[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(value),
    (line) => texts.push(line),
    32,
  );
  decoder.push(`${'a'.repeat(50)}\n${'b'.repeat(50)}\n{"type":"turn.completed"}\n`);
  decoder.end();

  assert.equal(texts.length, 2);
  assert.deepEqual(updates, [{ type: 'turn.completed' }]);
});

test('decoder: an overlong unterminated tail is dropped at end()', () => {
  const updates: unknown[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(value),
    (line) => texts.push(line),
    32,
  );
  decoder.push('q'.repeat(80));
  decoder.end();
  assert.deepEqual(updates, []);
  assert.equal(texts.length, 1);
});

test('decoder: end() discards an in-flight overlong line without parsing its tail', () => {
  const updates: unknown[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(value),
    (line) => texts.push(line),
    16,
  );
  decoder.push('z'.repeat(30)); // drops, enters dropping mode
  assert.equal(texts.length, 1);
  decoder.end();
  assert.deepEqual(updates, []);
  assert.equal(texts.length, 1);
});

test('decoder: empty pushes and empty input are no-ops', () => {
  const updates: unknown[] = [];
  const texts: string[] = [];
  const decoder = new JsonLineDecoder(
    (value) => updates.push(value),
    (line) => texts.push(line),
  );
  decoder.push('');
  decoder.push('\n\n');
  decoder.end();
  assert.deepEqual(updates, []);
  assert.deepEqual(texts, []);
});

test('decoder: normalizes a realistic interleaved codex session end to end', () => {
  const { updates, texts, decoder } = collector('codex');
  const lines = [
    JSON.stringify({ type: 'thread.started', thread_id: 'th-42' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({
      type: 'item.started',
      item: { id: '1', type: 'command_execution', command: 'npm test', aggregated_output: '' },
    }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: '1',
        type: 'command_execution',
        command: 'npm test',
        aggregated_output: 'passing\n',
        exit_code: 0,
      },
    }),
    'stray non-json line',
    JSON.stringify({ type: 'item.completed', item: { id: '2', type: 'agent_message', text: 'Tests pass.' } }),
    JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 3 } }),
  ];
  decoder.push(`${lines.join('\n')}\n`);
  decoder.end();

  assert.deepEqual(texts, ['stray non-json line']);
  assert.deepEqual(updates, [
    { sessionId: 'th-42' },
    {},
    { log: '$ npm test' },
    { log: '$ npm test\npassing' },
    { result: 'Tests pass.' },
    { completed: true },
  ]);
});
