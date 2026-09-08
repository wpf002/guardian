import { redirect } from "next/navigation";

/**
 * /cases was a second ranked list of the same rows /queue shows, under its own
 * nav entry and with its own row design, so the two disagreed about how a case
 * looks while agreeing about which cases there are. One list, and it is /queue:
 * the row there carries a line of the conversation, which is the whole point of
 * the product, and the proposal state a second reviewer needs.
 *
 * The route stays as a redirect rather than a 404 because /cases/[id] is still
 * the case itself and a bookmarked list should land somewhere useful.
 */
export default function CasesPage() {
  redirect("/queue");
}
