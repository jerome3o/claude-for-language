/**
 * The live side of a reply being written (docs/CHAT.md "Claude threads — live"): `claude_turn` events
 * to the OWNER's sockets (ChatHub, `broadcastToUser` — never anyone else's) and the text so far
 * written into the pending row, for the apps that poll (`GET /api/claude/threads/:id?since=`).
 *
 *   status 'thinking'   the runner took the reply
 *   status 'tool'       a read tool runs (`tool`: search_cards …)
 *   status 'streaming'  `text` = the WHOLE answer so far (a dropped frame never matters)
 *   status 'done'       `text` = the stored answer (sent after the row is written)
 *   status 'failed'     `error` = the readable reason (Retry)
 *
 * Throttled: a push at most every PUSH_INTERVAL_MS (≈ 20–40 frames a reply), a D1 write of the text
 * at most every WRITE_INTERVAL_MS (the poll fallback's cadence); both coalesce to the latest text and
 * run one at a time, in order. The D1 write also renews the runner's lease; long stretches without
 * text (a big tool input) renew it through `activity()`.
 */
import type { ClaudeTurnEvent, ClaudeTurnStatus } from '@shared/claude/api';
import { broadcastToUser } from '../chat/hub';
import type { Env } from '../../types';
import { renewLease, TURN_LEASE_SECONDS, writePartial } from './store';

export const PUSH_INTERVAL_MS = 120;
export const WRITE_INTERVAL_MS = 400;
/** A lease renewal while the model writes without text. */
export const LEASE_RENEW_MS = 10_000;

export type LiveEnv = Pick<Env, 'DB' | 'CHAT_HUB'>;

export interface LiveTurnTarget {
  userId: string;
  threadId: string;
  messageId: string;
}

export interface LiveTurnOptions {
  pushIntervalMs?: number;
  writeIntervalMs?: number;
  leaseSeconds?: number;
  /** Tests: where events go (default: the user's ChatHub). */
  push?: (event: ClaudeTurnEvent) => Promise<unknown>;
  now?: () => number;
}

/** A throttled, coalescing, one-at-a-time task (the push or the write). */
class Throttle {
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly intervalMs: number, private readonly run: () => Promise<unknown>, private readonly now: () => number) {}

  /** Something changed: run now if the interval passed, else once it has. */
  poke(): void {
    this.dirty = true;
    if (this.timer) return;
    const wait = this.last + this.intervalMs - this.now();
    if (wait <= 0) this.fire();
    else this.timer = setTimeout(() => this.fire(), wait);
  }

  private fire(): void {
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    this.last = this.now();
    this.chain = this.chain.then(() => this.run()).then(
      () => undefined,
      (err) => console.error('[claude-turn] live update failed', err instanceof Error ? err.message : err),
    );
  }

  /** Stops the timer and waits for what is running (the final write / push follows). */
  async settle(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
    await this.chain;
  }
}

export class LiveTurn {
  private seq = 0;
  private text = '';
  private closed = false;
  private lastRenew: number;
  private readonly push: (event: ClaudeTurnEvent) => Promise<unknown>;
  private readonly pushes: Throttle;
  private readonly writes: Throttle;
  private readonly now: () => number;
  private readonly leaseSeconds: number;

  constructor(private readonly env: LiveEnv, private readonly target: LiveTurnTarget, opts: LiveTurnOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.leaseSeconds = opts.leaseSeconds ?? TURN_LEASE_SECONDS;
    this.push = opts.push ?? ((event) => broadcastToUser(env, target.userId, event));
    this.pushes = new Throttle(opts.pushIntervalMs ?? PUSH_INTERVAL_MS, () => this.send('streaming', { text: this.text }), this.now);
    this.writes = new Throttle(opts.writeIntervalMs ?? WRITE_INTERVAL_MS, () => this.write(), this.now);
    this.lastRenew = this.now();
  }

  private send(status: ClaudeTurnStatus, extra: Partial<ClaudeTurnEvent> = {}): Promise<unknown> {
    const event: ClaudeTurnEvent = { type: 'claude_turn', thread_id: this.target.threadId, message_id: this.target.messageId, seq: ++this.seq, status, ...extra };
    return this.push(event).catch((err) => console.error('[claude-turn] push failed', err instanceof Error ? err.message : err));
  }

  private async write(): Promise<void> {
    this.lastRenew = this.now();
    await writePartial(this.env.DB, this.target.messageId, this.text, this.leaseSeconds);
  }

  /** The runner took the reply. */
  thinking(): void {
    if (!this.closed) void this.send('thinking');
  }

  /** A read tool is about to run. */
  tool(name: string): void {
    if (!this.closed) void this.send('tool', { tool: name });
  }

  /** The whole answer so far. */
  update(text: string): void {
    if (this.closed || text === this.text) return;
    this.text = text;
    this.pushes.poke();
    this.writes.poke();
  }

  /** Any stream event: keeps the lease while no text comes. */
  activity(): void {
    if (this.closed || this.now() - this.lastRenew < LEASE_RENEW_MS) return;
    this.lastRenew = this.now();
    void renewLease(this.env.DB, this.target.messageId, this.leaseSeconds).catch(() => undefined);
  }

  /** Stops the throttles (call BEFORE the row's final write, so no partial write lands after it). */
  async settle(): Promise<void> {
    this.closed = true;
    await Promise.all([this.pushes.settle(), this.writes.settle()]);
  }

  /** After the row is written: the stored answer. */
  async done(text: string): Promise<void> {
    await this.settle();
    await this.send('done', { text });
  }

  async failed(error: string): Promise<void> {
    await this.settle();
    await this.send('failed', { error });
  }

  /** Gave the reply back (a retryable failure): the apps show "Thinking…" again. */
  async released(): Promise<void> {
    await this.settle();
    await this.send('thinking', { text: '' });
  }
}
