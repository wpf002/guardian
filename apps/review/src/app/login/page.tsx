import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignInForm } from "./SignInForm";
import styles from "./page.module.css";

export const metadata = { title: "Sign In" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/queue");

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Sign In to Guardian</h1>
        <p className={styles.note}>Use the sign-in code your team gave you</p>
        <SignInForm />
      </div>
    </div>
  );
}
