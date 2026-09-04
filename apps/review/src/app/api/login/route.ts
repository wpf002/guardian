import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, sessionForToken, signSession } from "@/lib/auth";

/**
 * The token exchange, as a route rather than only a form, so a script can open
 * the console at a known seat. Pre-SSO, same as the form.
 *
 * The cookie is HttpOnly, SameSite Lax, and Secure in production. Possession of
 * a case URL is never the capability; this cookie is, which is exactly why it
 * cannot be settable by a URL:
 *
 *  - There is no GET handler. A cookie-setting operation on an idempotent GET
 *    is reachable from any cross-site link, image or redirect, so a link to
 *    this route with somebody else's seat token silently reseated whoever
 *    clicked it, and every decision they then recorded was attributed to that
 *    seat in the audit chain. SameSite governs which cookies a browser sends,
 *    not whether a Set-Cookie in the response is stored.
 *  - A seat token in a query string is a shared secret in the reverse proxy's
 *    access log, in browser history, and in any Referer a later page sends.
 *  - POST is same-origin only, checked against Origin and Sec-Fetch-Site, so a
 *    cross-site form cannot mint a session either.
 */
export const runtime = "nodejs";

/**
 * Same-origin check. Sec-Fetch-Site is sent by every current browser; Origin is
 * the fallback for the ones that are not, and a request with neither is refused
 * rather than trusted.
 */
function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function sign(token: string): NextResponse {
  const session = sessionForToken(token);
  if (!session) {
    return NextResponse.json(
      { error: "That token does not match a seat on this deployment." },
      { status: 401 },
    );
  }
  const response = NextResponse.json({
    reviewerId: session.reviewerId,
    role: session.role,
    customerId: session.customerId,
  });
  response.cookies.set(SESSION_COOKIE, signSession(session), sessionCookieOptions());
  return response;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Sign-in is same-origin only. Open the console and use the sign-in form." },
      { status: 403 },
    );
  }
  const contentType = request.headers.get("content-type") ?? "";
  let token = "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : "";
  } else {
    const form = await request.formData();
    token = String(form.get("token") ?? "");
  }
  return sign(token);
}
