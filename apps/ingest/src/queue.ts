import type { Event } from "@guardian/schema";

/**
 * Redis Streams with a partition per customer, so one noisy platform cannot
 * starve a small one (DESIGN.md 7, CLAUDE.md conventions).
 */

export interface EventQueue {
  publish(customerId: string, event: Event): Promise<string>;
}

export function streamKey(customerId: string): string {
  return `guardian:events:${customerId}`;
}

/** Minimal slice of ioredis this module needs, so tests need no server. */
export interface RedisLike {
  xadd(key: string, id: string, ...args: string[]): Promise<string | null>;
}

export class RedisEventQueue implements EventQueue {
  constructor(
    private readonly redis: RedisLike,
    private readonly maxLen = 100_000,
  ) {}

  async publish(customerId: string, event: Event): Promise<string> {
    const id = await this.redis.xadd(
      streamKey(customerId),
      "*",
      "event",
      JSON.stringify(event),
    );
    return id ?? "";
  }

  get trimTo(): number {
    return this.maxLen;
  }
}

export class MemoryEventQueue implements EventQueue {
  readonly published: Array<{ customerId: string; event: Event }> = [];

  async publish(customerId: string, event: Event): Promise<string> {
    this.published.push({ customerId, event });
    return `${this.published.length}-0`;
  }

  eventsFor(customerId: string): Event[] {
    return this.published.filter((p) => p.customerId === customerId).map((p) => p.event);
  }
}
