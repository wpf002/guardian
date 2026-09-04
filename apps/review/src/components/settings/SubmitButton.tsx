"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "@/components/Button";

/**
 * A submit button that knows about its own form.
 *
 * The pending flag from useActionState belongs to the action, and this page
 * renders one remove form per phrase against a single action. Reading the
 * status from the form means the row you pressed is the row that says working.
 */
export function SubmitButton({
  children,
  variant = "secondary",
  disabledReason,
}: {
  children: string;
  variant?: ButtonVariant;
  disabledReason?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} disabledReason={disabledReason}>
      {children}
    </Button>
  );
}
