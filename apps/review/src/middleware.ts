import { NextResponse, type NextRequest } from "next/server";

/**
 * Presence check only.
 *
 * Middleware runs on the edge runtime, which has no node:crypto, so the
 * signature is verified server side in requireSession() rather than here. This
 * redirects a request with no cookie at all, which keeps an unauthenticated
 * person off every route without pretending to be the access control. A forged
 * cookie gets past this and fails at the first requireSession().
 */
const SESSION_COOKIE = "guardian_session";

function mockMode(): boolean {
  if (process.env.GUARDIAN_MOCK === "1") return true;
  if (process.env.GUARDIAN_MOCK === "0") return false;
  return !process.env.DATABASE_URL;
}

export function middleware(request: NextRequest) {
  if (mockMode()) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico).*)"],
};
