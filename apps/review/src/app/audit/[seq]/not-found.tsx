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
      title="No chain entry at that sequence number."
      detail="Sequence numbers are assigned across every customer, so a number can exist in the chain and still not be readable from this seat."
      action={<Link href="/audit">Back to the chain</Link>}
    />
  );
}
