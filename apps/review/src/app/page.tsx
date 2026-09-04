import { redirect } from "next/navigation";

/**
 * Role-aware redirect. There is no landing screen: a person opening Guardian is
 * opening a queue.
 */
export default function Home() {
  redirect("/queue");
}
