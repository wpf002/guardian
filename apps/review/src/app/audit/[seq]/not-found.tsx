import Link from "next/link";
import { EmptyState } from "@/components";

/**
 * An entry that is not in this seat's slice reads as absent. That covers a
 * sequence number past the head, a number that is not a number, and an entry
 * recorded under another customer, and it says the same thing for all three on
 * purpose.
 */
export default function AuditEntryNotFound() {
  return (
    <EmptyState
      title="That record isn't available"
      detail="It may belong to another organization"
      action={<Link href="/audit">Back to the Evidence Log</Link>}
    />
  );
}
