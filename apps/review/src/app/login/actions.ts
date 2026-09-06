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
  const token = formString(formData, "token");
  const session = sessionForToken(token);
  if (!session) {
    return { error: "That token does not match a seat on this deployment." };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(session), sessionCookieOptions());
  redirect("/queue");
}

/**
 * A form field, as a string.
 *
 * FormData.get returns a string or a File, and String(file) is
 * "[object File]": a filename-shaped value that passes every length check and
 * means nothing. A field that arrived as a file is not a field the caller
 * asked for, so it reads as absent.
 */
function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
