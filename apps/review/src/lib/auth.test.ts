import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  loadReviewers,
  resolveSession,
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

/**
 * There is no session table and no revocation list, so a cookie is only as
 * current as the roster it is checked against. Reading role and customerId out
 * of the cookie body meant an offboarded seat kept owner rights for up to
 * twelve hours, and the only remedy was rotating the secret and signing out
 * everybody.
 */
describe("re-resolving a session against the roster", () => {
  const roster = [
    { id: "rev_ar", name: "A. Rivera", role: "owner", customerId: "cus_northwood", token: "t1" },
  ];

  afterEach(() => {
    delete process.env.REVIEWERS;
  });

  it("takes role and customerId from the roster row, not from the cookie", () => {
    process.env.REVIEWERS = JSON.stringify(roster);
    const claim: Session = { ...session, role: "owner", customerId: "cus_elsewhere" };
    expect(resolveSession(claim)).toMatchObject({
      reviewerId: "rev_ar",
      role: "owner",
      customerId: "cus_northwood",
    });
  });

  it("demotes on the next request rather than at the end of the window", () => {
    process.env.REVIEWERS = JSON.stringify([{ ...roster[0], role: "reviewer" }]);
    const claim: Session = { ...session, role: "owner" };
    expect(resolveSession(claim)?.role).toBe("reviewer");
  });

  it("is not a session at all once the seat is off the roster", () => {
    process.env.REVIEWERS = JSON.stringify([]);
    expect(resolveSession(session)).toBeNull();
  });
});
