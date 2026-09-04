/**
 * Pre-SSO auth, as a request sees it.
 *
 * This is a deliberate placeholder with a stated replacement, not an
 * architecture. What replaces it is SSO against the customer's own identity
 * provider plus a real Reviewer table, so a decision references a row rather
 * than a string from an env var. Until then Review.reviewerId holds the id from
 * this JSON, which is stable enough to audit and not stable enough to ship to a
 * customer. Say so in the operator agreement.
 *
 * Everything pure lives in ./session and is re-exported here, so "@/lib/auth"
 * remains the one name routes and server actions import. What is left in this
 * file is the three functions that read the incoming request, each of which
 * imports next/* lazily.
 */

import { isMockMode } from "./db";
import {
  SESSION_COOKIE,
  mockSession,
  resolveSession,
  roleAllows,
  verifySessionCookie,
  type Role,
  type Session,
} from "./session";

export * from "./session";

/**
 * Reads the cookie. Mock mode signs in the default seat so the app runs with no
 * environment at all.
 */
export async function getSession(): Promise<Session | null> {
  if (isMockMode()) return mockSession();
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return resolveSession(verifySessionCookie(jar.get(SESSION_COOKIE)?.value));
}

/** Every server component and route handler gets the session from here. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  const { redirect } = await import("next/navigation");
  // redirect throws. Returning it keeps the never type visible to the caller.
  return redirect("/login");
}

/**
 * Role gate. A reviewer who reaches an operator route gets the not-found state
 * rather than a 403, because a 403 confirms the route means something here.
 */
export async function requireRole(minimum: Role): Promise<Session> {
  const session = await requireSession();
  if (roleAllows(session.role, minimum)) return session;
  const { notFound } = await import("next/navigation");
  return notFound();
}
