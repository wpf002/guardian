import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/auth";
import { listQueue } from "@/lib/data/cases";
import { navForRole } from "@/lib/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Guardian review console",
  description:
    "Reviewer queue for Guardian. Risk tiers and evidence bundles for human review.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // The sign-in route renders without the shell, because there is nothing to
  // navigate to yet.
  if (!session) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  // A failed queue read must not blank the whole app, so the rail renders
  // without its count rather than throwing.
  let queueCount: number | undefined;
  try {
    const page = await listQueue(session, { limit: 1 });
    queueCount = page.summary.total;
  } catch {
    queueCount = undefined;
  }

  return (
    <html lang="en">
      <body>
        <AppShell
          session={{ displayName: session.displayName, role: session.role }}
          nav={navForRole(session.role, { queue: queueCount })}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
