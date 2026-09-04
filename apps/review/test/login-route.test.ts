/**
 * Sign-in mints the capability, so the ways it can be reached are the ways a
 * session can be planted on somebody.
 *
 * There was a GET handler that read a seat token from the query string and set
 * the cookie. A cookie-setting operation on an idempotent GET is reachable from
 * any cross-site link, image or redirect: a link to it with an attacker's seat
 * token silently reseated whoever clicked, and the decisions they then recorded
 * were written to the audit chain under that seat. SameSite governs which
 * cookies a browser sends, not whether a Set-Cookie is stored.
 */

import { describe, expect, it } from "vitest";

const route = await import("@/app/api/login/route");

const ROSTER = JSON.stringify([
  { id: "rev_a", name: "A. Rivera", role: "owner", customerId: "cus_northwood", token: "tok_a" },
]);

function post(headers: Record<string, string>): Request {
  return new Request("https://console.example/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ token: "tok_a" }),
  });
}

describe("the sign-in route", () => {
  it("has no GET handler at all", () => {
    expect("GET" in route).toBe(false);
  });

  it("refuses a cross-site POST rather than minting a session", async () => {
    process.env.REVIEWERS = ROSTER;
    process.env.SESSION_SECRET = "a-test-secret-of-sufficient-length";
    try {
      const response = await route.POST(post({ "sec-fetch-site": "cross-site" }));
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    } finally {
      delete process.env.REVIEWERS;
      delete process.env.SESSION_SECRET;
    }
  });

  it("refuses a POST that declares no origin at all", async () => {
    process.env.REVIEWERS = ROSTER;
    process.env.SESSION_SECRET = "a-test-secret-of-sufficient-length";
    try {
      const response = await route.POST(post({}));
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    } finally {
      delete process.env.REVIEWERS;
      delete process.env.SESSION_SECRET;
    }
  });

  it("signs in a same-origin POST from the console's own form", async () => {
    process.env.REVIEWERS = ROSTER;
    process.env.SESSION_SECRET = "a-test-secret-of-sufficient-length";
    try {
      const response = await route.POST(post({ "sec-fetch-site": "same-origin" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toMatch(/guardian_session=/);
    } finally {
      delete process.env.REVIEWERS;
      delete process.env.SESSION_SECRET;
    }
  });
});
