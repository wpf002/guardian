"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { signInAction, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);

  return (
    <form action={formAction}>
      <Field
        id="token"
        name="token"
        label="Seat token"
        type="password"
        autoComplete="off"
        required
        help="Pre-SSO. Your operator issues one token per seat. Single sign-on replaces this."
        error={state.error ?? undefined}
      />
      <p style={{ marginBlockStart: "var(--space-4)" }}>
        <Button type="submit" variant="primary" loading={pending}>
          Sign in
        </Button>
      </p>
    </form>
  );
}
