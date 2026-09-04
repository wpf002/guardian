import { LoadingState } from "@/components";

/** Names what is loading and how much of it, at the height the rows will take. */
export default function AuditLoading() {
  return (
    <LoadingState
      label="Reading the chain head and the newest 25 entries."
      count={6}
      rowHeight={64}
    />
  );
}
