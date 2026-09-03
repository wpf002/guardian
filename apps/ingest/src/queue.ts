import type { Event } from "@guardian/schema";

/**
 * Redis Streams with a partition per customer, so one noisy platform cannot
 * starve a small one (DESIGN.md 7, CLAUDE.md conventions).
 *
 * Partitions are separate keys in one shared Redis, which isolates consumer
 * latency but not memory. Every append trims the stream to roughly `maxLen`
 * entries, and the edge stops accepting for a customer whose partition is
 * near that cap, so a stalled scorer or a runaway producer cannot grow one
 * key until Redis fails for everyone. Trimming also bounds how long a queued
 * event's raw text sits in Redis (rule 7).
 */

export interface EventQueue {
  publish(customerId: string, event: Event): Promise<string>;
  /**
   * True when the customer's partition is at its backpressure mark and the
   * edge should answer 429 rather than append. Optional: a queue with no
   * bound never reports full.
   */
  isFull?(customerId: string): Promise<boolean>;
}

export function streamKey(customerId: string): string {
  return `guardian:events:${customerId}`;
}

/** Minimal slice of ioredis this module needs, so tests need no server. */
export interface RedisLike {
  xadd(key: string, ...args: Array<string | number>): Promise<string | null>;
  xlen(key: string): Promise<number>;
}

export interface RedisEventQueueOptions {
  /** Approximate cap per partition, applied on every append as MAXLEN ~. */
  maxLen?: number;
  /** Partition length at which the edge starts refusing with 429. Defaults to 90% of maxLen. */
  backpressureAt?: number;
}

export const DEFAULT_STREAM_MAX_LEN = 100_000;

export class RedisEventQueue implements EventQueue {
  private readonly maxLen: number;
  private readonly backpressureAt: number;

  constructor(
    private readonly redis: RedisLike,
    opts: RedisEventQueueOptions | number = {},
  ) {
    const options = typeof opts === "number" ? { maxLen: opts } : opts;
    this.maxLen = options.maxLen ?? DEFAULT_STREAM_MAX_LEN;
    this.backpressureAt = options.backpressureAt ?? Math.floor(this.maxLen * 0.9);
  }

  async publish(customerId: string, event: Event): Promise<string> {
    // MAXLEN with ~ lets Redis trim at node boundaries, which is cheap. The
    // oldest entries go first; the backpressure check in isFull is what keeps
    // an unconsumed event from being the one trimmed.
    const id = await this.redis.xadd(
      streamKey(customerId),
      "MAXLEN",
      "~",
      String(this.maxLen),
      "*",
      "event",
      JSON.stringify(event),
    );
    return id ?? "";
  }

  async isFull(customerId: string): Promise<boolean> {
    const length = await this.redis.xlen(streamKey(customerId));
    return length >= this.backpressureAt;
  }

  get trimTo(): number {
    return this.maxLen;
  }
}

export class MemoryEventQueue implements EventQueue {
  readonly published: Array<{ customerId: string; event: Event }> = [];
  /** Set by a test to simulate a partition at its cap. */
  full = false;

  async publish(customerId: string, event: Event): Promise<string> {
    this.published.push({ customerId, event });
    return `${this.published.length}-0`;
  }

  async isFull(): Promise<boolean> {
    return this.full;
  }

  eventsFor(customerId: string): Event[] {
    return this.published.filter((p) => p.customerId === customerId).map((p) => p.event);
  }
}
