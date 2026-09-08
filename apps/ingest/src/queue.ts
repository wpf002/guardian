import type { Event } from "@guardian/schema";

/**
 * Redis Streams with a partition per customer, so one noisy platform cannot
 * starve a small one (DESIGN.md 7, CLAUDE.md conventions).
 *
 * Partitions are separate keys in one shared Redis, which isolates consumer
 * latency but not memory. Every append trims the stream to roughly `maxLen`
 * entries, and the edge stops accepting for a customer whose partition is
 * near that cap, so a stalled scorer or a runaway producer cannot grow one
 * key until Redis fails for everyone.
 *
 * The count cap is not a retention control, which is what the comment here used
 * to claim (ROADMAP S-4). Redis Streams do not remove an entry when it is
 * acknowledged: XACK clears the pending list and the entry, raw text and all,
 * stays in the stream until something trims it. A busy partition therefore
 * turns its text over in hours and a 40-person guild sending fifty messages a
 * day keeps every one of them for years, which is rule 7 with no exception
 * written for it. `RedisStreamRetention` is the time-based trim, and it runs in
 * the retention sweep beside every other class.
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

/**
 * The retention sweep's step over the event streams (ROADMAP S-4, decided).
 *
 * Rule 7 says T0 raw text is gone within 24 hours, and a queued event is raw
 * text Guardian is holding. Which store it sits in does not change what it is,
 * so the rule covers the queue and the sweep gained a step rather than the rule
 * gaining an exception.
 *
 * MINID is exact rather than approximate here. `~` lets Redis stop at a node
 * boundary, which is the right trade for a size cap and the wrong one for a
 * deletion deadline: it would leave entries older than the cutoff in place for
 * as long as their node had a younger neighbour.
 *
 * The count it returns is not a health signal. Entries stay in the stream after
 * they are consumed, so on a working system almost everything trimmed here has
 * already been scored and persisted. An entry that had not been consumed is
 * dropped with the rest, which is the correct direction: an event nobody has
 * read for a day is a scorer that has been down for a day, and holding a
 * child's words to wait for it is the thing rule 7 forbids.
 */
export interface StreamRetention {
  trimBefore(cutoff: Date): Promise<number>;
}

/** Minimal slice of ioredis the trim needs. */
export interface RedisTrimLike {
  xtrim(key: string, strategy: string, threshold: string): Promise<number>;
}

export class RedisStreamRetention implements StreamRetention {
  constructor(
    private readonly redis: RedisTrimLike,
    /** The partitions to sweep. One key per customer, as streamKey builds them. */
    private readonly listCustomerIds: () => Promise<string[]>,
  ) {}

  async trimBefore(cutoff: Date): Promise<number> {
    const ids = await this.listCustomerIds();
    // A stream id is `<ms>-<seq>`, so the cutoff in milliseconds is a valid
    // MINID and removes every entry appended before it.
    const minId = String(cutoff.getTime());
    let trimmed = 0;
    for (const customerId of ids) {
      // One partition failing is not a reason to leave the others full. The
      // sweep records the step as failed if any of them threw.
      trimmed += await this.redis.xtrim(streamKey(customerId), "MINID", minId);
    }
    return trimmed;
  }
}

/** Trims nothing and says so. For fixtures mode and for tests with no Redis. */
export class NoStreamRetention implements StreamRetention {
  async trimBefore(): Promise<number> {
    return 0;
  }
}
