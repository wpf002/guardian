import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, sessionForToken, signSession } from "@/lib/auth";

/**
 * The token exchange, as a route rather than only a form, so a demo or a script
 * can open the console at a known seat. Pre-SSO, same as the form.
 *
 * The cookie is HttpOnly, SameSite Lax, and Secure in production. Possession of
 * a case URL is never the capability; this cookie is.
 */
export const runtime = "nodejs";

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

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  return sign(token);
}

export async function POST(request: Request): Promise<NextResponse> {
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
