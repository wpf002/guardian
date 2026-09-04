import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignInForm } from "./SignInForm";
import styles from "./page.module.css";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/queue");

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Guardian review console</h1>
        <p className={styles.note}>
          Guardian emits risk tiers and evidence bundles for human review. Sign in with the token
          your operator issued for your seat.
        </p>
        <SignInForm />
      </div>
    </div>
  );
}
