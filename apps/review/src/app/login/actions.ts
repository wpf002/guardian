"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionCookieOptions, sessionForToken, signSession } from "@/lib/auth";

export interface SignInState {
  error: string | null;
}

/**
 * Exchanges a seat token for the signed session cookie. Pre-SSO: the roster is
 * the REVIEWERS environment variable, and the token is that seat's shared
 * secret. A bad token gets one message, never a hint about which seats exist.
 */
export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const token = String(formData.get("token") ?? "");
  const session = sessionForToken(token);
  if (!session) {
    return { error: "That token does not match a seat on this deployment." };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(session), sessionCookieOptions());
  redirect("/queue");
}
