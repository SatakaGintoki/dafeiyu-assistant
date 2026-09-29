/**
 * Pure NDJSON event normalizer for the JSON streams emitted by
 * `codex exec --json` and `claude -p --output-format stream-json`.
 *
 * Both producers write one JSON object per line and both may split a line
 * arbitrarily across stdout chunks, so decoding is kept separate from
 * interpretation:
 *
 *   JsonLineDecoder  -> turns arbitrary string chunks into JSON values
 *   normalizeEvent   -> turns one JSON value into an ExecutionUpdate
 *
 * Neither function has dependencies, performs I/O, or throws on malformed
 * input; anything unrecognized simply yields an empty update.
 */

export type ExecutionUpdate = {
  log?: string;
  result?: string;
  error?: string;
  sessionId?: string;
  completed?: boolean;
  permissionDenied?: boolean;
};

/** Default cap for a single buffered NDJSON line (256 KiB). */
const DEFAULT_MAX_LINE_BYTES = 256 * 1024;

/** Aggregated command output kept in a log line before truncation. */
const MAX_COMMAND_OUTPUT_CHARS = 4_000;

/* ------------------------------------------------------------------ */
/* small, total helpers                                                */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Best-effort message text from a string or an object carrying `message`. */
function messageOf(value: unknown): string | undefined {
  const direct = asNonEmptyString(value);
  if (direct !== undefined) return direct;
  if (isRecord(value)) return asNonEmptyString(value.message);
  return undefined;
}

function errorsOf(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const entry of value) {
    const message = messageOf(entry);
    if (message !== undefined) parts.push(message);
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function bound(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

/* ------------------------------------------------------------------ */
/* codex exec --json                                                   */
/* ------------------------------------------------------------------ */

function commandLog(item: Record<string, unknown>, finished: boolean): string | undefined {
  const command = asNonEmptyString(item.command);
  if (command === undefined && !finished) return undefined;

  const parts = [command !== undefined ? `$ ${command}` : '$ (command)'];
  if (finished) {
    const output = asString(item.aggregated_output);
    if (output !== undefined) {
      const trimmed = output.replace(/\s+$/, '');
      if (trimmed.length > 0) parts.push(bound(trimmed, MAX_COMMAND_OUTPUT_CHARS));
    }
    const exit = item.exit_code;
    if (typeof exit === 'number' && Number.isFinite(exit) && exit !== 0) {
      parts.push(`[exit code ${exit}]`);
    }
  }
  return parts.join('\n');
}

function normalizeCodex(event: Record<string, unknown>): ExecutionUpdate {
  switch (asString(event.type)) {
    case 'thread.started': {
      const threadId = asString(event.thread_id) ?? asString(event.threadId);
      return threadId !== undefined ? { sessionId: threadId } : {};
    }
    case 'item.started':
    case 'item.completed': {
      if (!isRecord(event.item)) return {};
      const item = event.item;
      const itemType = asString(item.type);

      if (itemType === 'command_execution') {
        const log = commandLog(item, event.type === 'item.completed');
        return log !== undefined ? { log } : {};
      }
      // A completed agent message is a candidate answer; the turn may still
      // continue, so it must never be reported as completed.
      if (itemType === 'agent_message' && event.type === 'item.completed') {
        const text = asString(item.text);
        return text !== undefined ? { result: text } : {};
      }
      return {};
    }
    case 'turn.completed':
      return { completed: true };
    case 'turn.failed': {
      const error = messageOf(event.error) ?? messageOf(event.message);
      return { error: error ?? 'codex turn failed' };
    }
    case 'error': {
      const error = messageOf(event.message) ?? messageOf(event.error);
      return { error: error ?? 'codex error' };
    }
    default:
      return {};
  }
}

/* ------------------------------------------------------------------ */
/* claude -p --output-format stream-json                               */
/* ------------------------------------------------------------------ */

/** Log text from an assistant message: only its `text` content blocks. */
function assistantLog(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const content = message.content;
  if (typeof content === 'string') return content.length > 0 ? content : undefined;
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'text') continue;
    const text = asString(block.text);
    if (text !== undefined && text.length > 0) parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function deniedToolNames(denials: unknown[]): string[] {
  const names: string[] = [];
  for (const denial of denials) {
    let name: string | undefined;
    if (typeof denial === 'string') {
      name = asNonEmptyString(denial);
    } else if (isRecord(denial)) {
      name =
        asNonEmptyString(denial.tool_name) ??
        asNonEmptyString(denial.toolName) ??
        asNonEmptyString(denial.name);
    }
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

function normalizeClaudeResult(event: Record<string, unknown>, sessionId?: string): ExecutionUpdate {
  const update: ExecutionUpdate = {};
  if (sessionId !== undefined) update.sessionId = sessionId;

  const subtype = asString(event.subtype);
  const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];

  // A denial means the run did not deliver a trustworthy answer, even though
  // the CLI may still exit with status 0.
  if (denials.length > 0) {
    const names = deniedToolNames(denials);
    update.permissionDenied = true;
    update.error =
      names.length > 0
        ? `Claude Code permission denied for: ${names.join(', ')}`
        : `Claude Code permission denied for ${denials.length} tool request(s)`;
    return update;
  }

  const result = asString(event.result);
  const isErrorFlag =
    event.is_error === true ||
    (typeof event.is_error !== 'boolean' && Boolean(event.is_error));
  const failed = isErrorFlag || (subtype !== undefined && subtype !== 'success');

  if (failed) {
    update.error =
      asNonEmptyString(result) ??
      errorsOf(event.errors) ??
      `Claude Code result failed (${subtype ?? 'error'})`;
    return update;
  }

  // A bare/malformed result envelope is not evidence of a successful turn.
  if (result === undefined && subtype !== 'success') return update;

  if (result !== undefined) update.result = result;
  update.completed = true;
  return update;
}

function normalizeClaude(event: Record<string, unknown>): ExecutionUpdate {
  const sessionId = asString(event.session_id) ?? asString(event.sessionId);

  switch (asString(event.type)) {
    case 'system':
      return sessionId !== undefined ? { sessionId } : {};
    case 'assistant': {
      const log = assistantLog(event.message);
      return log !== undefined ? { log } : {};
    }
    case 'user':
      // User turns and tool results are input/plumbing, never final answers.
      return {};
    case 'result':
      return normalizeClaudeResult(event, sessionId);
    default:
      return sessionId !== undefined ? { sessionId } : {};
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Map one decoded JSON value from an executor's stream onto an update.
 * Never throws: unknown shapes, wrong types and null all return `{}`.
 */
export function normalizeEvent(executor: 'codex' | 'claude', event: unknown): ExecutionUpdate {
  try {
    if (!isRecord(event)) return {};
    if (executor === 'codex') return normalizeCodex(event);
    if (executor === 'claude') return normalizeClaude(event);
    return {};
  } catch {
    return {};
  }
}

/**
 * Incremental NDJSON splitter.
 *
 * - Handles chunks that split lines (including inside a multi-byte character,
 *   as long as the caller decodes bytes with `StringDecoder`).
 * - Tolerates CRLF and a final line without a trailing newline.
 * - Non-JSON lines are forwarded to `onText`; empty lines are ignored.
 * - A line longer than `maxLineBytes` (UTF-8 bytes) is dropped up to and including the
 *   next newline, and a single bounded warning is sent to `onText`. The
 *   discarded tail is never parsed, so a truncated object cannot leak out.
 */
export class JsonLineDecoder {
  private readonly onEvent: (value: unknown) => void;
  private readonly onText: (line: string) => void;
  private readonly maxLineBytes: number;
  private buffer = '';
  private dropping = false;

  constructor(
    onEvent: (value: unknown) => void,
    onText: (line: string) => void,
    maxLineBytes: number = DEFAULT_MAX_LINE_BYTES,
  ) {
    this.onEvent = onEvent;
    this.onText = onText;
    this.maxLineBytes =
      Number.isFinite(maxLineBytes) && maxLineBytes > 0
        ? Math.max(1, Math.floor(maxLineBytes))
        : DEFAULT_MAX_LINE_BYTES;
  }

  push(chunk: string): void {
    if (typeof chunk !== 'string' || chunk.length === 0) return;

    let data = chunk;
    if (this.dropping) {
      // Still inside a discarded line: wait for its newline, keep nothing.
      const newline = data.indexOf('\n');
      if (newline === -1) return;
      data = data.slice(newline + 1);
      this.dropping = false;
      if (data.length === 0) return;
    }

    this.buffer += data;
    this.drain();
  }

  end(): void {
    if (this.dropping) {
      this.dropping = false;
      this.buffer = '';
      return;
    }
    const rest = this.buffer;
    this.buffer = '';
    if (rest.length === 0) return;
    if (Buffer.byteLength(rest, 'utf8') > this.maxLineBytes) {
      this.warnOverlong();
      return;
    }
    this.handleLine(rest);
  }

  private drain(): void {
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) {
        if (Buffer.byteLength(this.buffer, 'utf8') > this.maxLineBytes) {
          this.buffer = '';
          this.dropping = true;
          this.warnOverlong();
        }
        return;
      }
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > this.maxLineBytes) {
        this.warnOverlong();
        continue;
      }
      this.handleLine(line);
    }
  }

  private handleLine(raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.length === 0) return;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.onText(line);
      return;
    }
    this.onEvent(value);
  }

  private warnOverlong(): void {
    this.onText(`executor-events: dropped an overlong line (>${this.maxLineBytes} bytes)`);
  }
}
