import { afterEach, describe, expect, it } from "vitest";
import { isMockMode } from "./db";

/**
 * Mock mode is not a display setting. It disables the whole auth stack: the
 * middleware waves every request through, getSession returns the owner seat
 * without reading a cookie, and requireRole("owner") succeeds for an anonymous
 * visitor.
 *
 * It used to turn itself on whenever DATABASE_URL was unset, with no
 * environment guard, so a deploy whose database service was unlinked or not yet
 * attached booted quietly and served the whole console, on fixtures, to whoever
 * found the URL.
 */
describe("mock mode", () => {
  const saved = {
    mock: process.env.GUARDIAN_MOCK,
    db: process.env.DATABASE_URL,
    node: process.env.NODE_ENV,
  };

  function set(key: string, value: string | undefined) {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else (process.env as Record<string, string | undefined>)[key] = value;
  }

  afterEach(() => {
    set("GUARDIAN_MOCK", saved.mock);
    set("DATABASE_URL", saved.db);
    set("NODE_ENV", saved.node);
  });

  it("is inferred from a missing DATABASE_URL in development, so a checkout starts", () => {
    set("GUARDIAN_MOCK", undefined);
    set("DATABASE_URL", undefined);
    set("NODE_ENV", "development");
    expect(isMockMode()).toBe(true);
  });

  it("is never inferred in production, so an unlinked database fails loudly", () => {
    set("GUARDIAN_MOCK", undefined);
    set("DATABASE_URL", undefined);
    set("NODE_ENV", "production");
    expect(isMockMode()).toBe(false);
  });

  it("stays off in production when a database is configured", () => {
    set("GUARDIAN_MOCK", undefined);
    set("DATABASE_URL", "postgres://localhost:5433/guardian");
    set("NODE_ENV", "production");
    expect(isMockMode()).toBe(false);
  });

  it("still honours the explicit opt-out", () => {
    set("GUARDIAN_MOCK", "0");
    set("DATABASE_URL", undefined);
    set("NODE_ENV", "development");
    expect(isMockMode()).toBe(false);
  });
});
