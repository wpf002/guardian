import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  loadReviewers,
  roleAllows,
  sessionForToken,
  signSession,
  verifySessionCookie,
  type Session,
} from "./auth";

const SECRET = "a-test-secret-of-sufficient-length";

const session: Session = {
  reviewerId: "rev_ar",
  displayName: "A. Rivera",
  role: "reviewer",
  customerId: "cus_northwood",
  issuedAt: Date.now(),
};

describe("session cookie", () => {
  it("round trips a session", () => {
    const cookie = signSession(session, SECRET);
    expect(verifySessionCookie(cookie, { secret: SECRET })).toEqual(session);
  });

  it("rejects a tampered payload", () => {
    const cookie = signSession(session, SECRET);
    const forged = cookie.replace(/^[^.]+/, Buffer.from('{"role":"owner"}').toString("base64url"));
    expect(verifySessionCookie(forged, { secret: SECRET })).toBeNull();
  });

  it("rejects a cookie signed with another key", () => {
    const cookie = signSession(session, SECRET);
    expect(verifySessionCookie(cookie, { secret: "a-different-secret-entirely" })).toBeNull();
  });

  it("expires after the session lifetime", () => {
    const cookie = signSession(session, SECRET);
    const later = session.issuedAt + SESSION_TTL_MS + 1000;
    expect(verifySessionCookie(cookie, { secret: SECRET, now: later })).toBeNull();
  });

  it("rejects an empty or malformed value", () => {
    expect(verifySessionCookie(undefined, { secret: SECRET })).toBeNull();
    expect(verifySessionCookie("not-a-cookie", { secret: SECRET })).toBeNull();
  });
});

describe("the reviewer roster", () => {
  it("drops malformed entries rather than failing sign-in for everyone", () => {
    const raw = JSON.stringify([
      { id: "rev_ar", name: "A. Rivera", role: "reviewer", customerId: "cus_a", token: "t1" },
      { id: "rev_bad", name: "No role", customerId: "cus_a", token: "t2" },
      { id: "rev_mo", name: "M. Osei", role: "operator", customerId: "cus_a", token: "t3" },
    ]);
    const roster = loadReviewers(raw);
    expect(roster.map((r) => r.id)).toEqual(["rev_ar", "rev_mo"]);
  });

  it("returns nothing for unparseable JSON", () => {
    expect(loadReviewers("{oh no")).toEqual([]);
  });

  it("signs in the mock seat when the roster is unset in mock mode", () => {
    const found = sessionForToken("mock");
    expect(found?.customerId).toBe("cus_northwood");
    expect(sessionForToken("wrong-token")).toBeNull();
  });
});

describe("roles", () => {
  it("ranks operator above reviewer and owner above operator", () => {
    expect(roleAllows("owner", "operator")).toBe(true);
    expect(roleAllows("operator", "reviewer")).toBe(true);
    expect(roleAllows("reviewer", "operator")).toBe(false);
  });
});
