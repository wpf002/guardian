/**
 * Session identity, the reviewer roster and the signed cookie, with nothing in
 * it that touches the Next.js request.
 *
 * Split out of ./auth so the data layer and lib/decisions.ts can be imported by
 * a process that is not a Next server: scripts/integration drives a real T3
 * decision through recordDecision, and every module in that graph type-imports
 * Session. Pulling next/headers in behind a type made that impossible.
 *
 * ./auth re-exports all of this, so "@/lib/auth" stays the name every route and
 * server action uses. Only the three functions that read the request live
 * there now.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isMockMode } from "./db";

export const SESSION_COOKIE = "guardian_session";

/** Twelve hours, and end of shift, whichever comes first. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const ROLES = ["reviewer", "operator", "owner"] as const;
export type Role = (typeof ROLES)[number];

export interface Session {
  reviewerId: string;
  displayName: string;
  role: Role;
  customerId: string;
  issuedAt: number;
}

/** One row of the REVIEWERS env JSON. The token is the shared secret for that seat. */
export interface ReviewerRecord {
  id: string;
  name: string;
  role: Role;
  customerId: string;
  token: string;
}

/** The seat mock mode signs in automatically, so the app runs with no env at all. */
export const MOCK_REVIEWER: ReviewerRecord = {
  id: "rev_mock",
  name: "A. Rivera",
  role: "owner",
  customerId: "cus_northwood",
  token: "mock",
};

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  // The known literal exists so a laptop with no environment can sign a cookie.
  // It is a published string, so any cookie minted with it is forgeable by
  // anyone who has read this repository, and it is refused outside development.
  if (isMockMode() && process.env.NODE_ENV !== "production") {
    return "guardian-mock-session-secret-not-for-real-use";
  }
  throw new Error("SESSION_SECRET must be set to at least 16 characters");
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Parses REVIEWERS. A malformed entry is dropped rather than crashing sign-in for everyone. */
export function loadReviewers(raw = process.env.REVIEWERS): ReviewerRecord[] {
  if (!raw) return isMockMode() ? [MOCK_REVIEWER] : [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ReviewerRecord[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.id === "string" &&
      typeof row.name === "string" &&
      isRole(row.role) &&
      typeof row.customerId === "string" &&
      typeof row.token === "string" &&
      row.token.length > 0
    ) {
      out.push({
        id: row.id,
        name: row.name,
        role: row.role,
        customerId: row.customerId,
        token: row.token,
      });
    }
  }
  return out;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signSession(session: Session, secret = sessionSecret()): string {
  const body = base64url(
    JSON.stringify({
      reviewerId: session.reviewerId,
      displayName: session.displayName,
      role: session.role,
      customerId: session.customerId,
      issuedAt: session.issuedAt,
    }),
  );
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** Returns null on any failure. A caller never learns which half went wrong. */
export function verifySessionCookie(
  value: string | undefined,
  opts: { now?: number; secret?: string } = {},
): Session | null {
  if (!value) return null;
  const secret = opts.secret ?? sessionSecret();
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64url(body));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  if (
    typeof row.reviewerId !== "string" ||
    typeof row.displayName !== "string" ||
    !isRole(row.role) ||
    typeof row.customerId !== "string" ||
    typeof row.issuedAt !== "number"
  ) {
    return null;
  }
  const now = opts.now ?? Date.now();
  if (now - row.issuedAt > SESSION_TTL_MS) return null;
  if (row.issuedAt - now > 60_000) return null;
  return {
    reviewerId: row.reviewerId,
    displayName: row.displayName,
    role: row.role,
    customerId: row.customerId,
    issuedAt: row.issuedAt,
  };
}

/** Exchanges a seat token for a session. Returns null when no seat matches. */
export function sessionForToken(token: string, now = Date.now()): Session | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const match = loadReviewers().find((r) => r.token === trimmed);
  if (!match) return null;
  return {
    reviewerId: match.id,
    displayName: match.name,
    role: match.role,
    customerId: match.customerId,
    issuedAt: now,
  };
}

export function mockSession(now = Date.now()): Session {
  return {
    reviewerId: MOCK_REVIEWER.id,
    displayName: MOCK_REVIEWER.name,
    role: MOCK_REVIEWER.role,
    customerId: MOCK_REVIEWER.customerId,
    issuedAt: now,
  };
}

/** Role rank. An operator can do anything a reviewer can, and an owner anything an operator can. */
const RANK: Record<Role, number> = { reviewer: 0, operator: 1, owner: 2 };

export function roleAllows(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/**
 * Re-resolves the seat against the current roster on every request.
 *
 * The cookie proves identity and nothing else. Role and customerId come from
 * the roster row, so removing a seat or demoting an owner takes effect on the
 * next request rather than up to twelve hours later: there is no session table
 * to revoke against, and rotating SESSION_SECRET signs out everybody. A cookie
 * whose id is no longer on the roster is not a session.
 */
export function resolveSession(claim: Session | null): Session | null {
  if (!claim) return null;
  const seat = loadReviewers().find((r) => r.id === claim.reviewerId);
  if (!seat) return null;
  return {
    reviewerId: seat.id,
    displayName: seat.name,
    role: seat.role,
    customerId: seat.customerId,
    issuedAt: claim.issuedAt,
  };
}

/** Cookie options. HttpOnly, Secure outside development, SameSite Lax. */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
