import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { getSession } from "@/lib/auth";
import { isMockMode } from "@/lib/db";
import { listQueue } from "@/lib/data/cases";
import { navForRole } from "@/lib/nav";
import "./globals.css";

export const metadata: Metadata = {
  // Every route names itself. Two cases open in two tabs have to be tellable
  // apart, and the title is the first thing a screen reader speaks on a load.
  title: {
    default: "Guardian review console",
    template: "%s · Guardian review console",
  },
  description:
    "Reviewer queue for Guardian. Risk tiers and evidence bundles for human review.",
};

/**
 * Stamps the stored theme on the root element before the first paint.
 *
 * Without it a reviewer whose choice disagrees with their operating system gets
 * a full screen of the wrong theme until the client bundle hydrates, on a
 * surface that carries threat and coercion excerpts. The script is inline and
 * blocking on purpose, and it is the first thing in the document body.
 *
 * It runs before React hydrates, so by the time React reaches <html> the
 * attribute is already on the element and the server markup React is comparing
 * against has none. That is a hydration mismatch on every single load, and it
 * was showing as an error count in the dev overlay. suppressHydrationWarning on
 * the html element is the documented answer. It covers that element's own
 * attributes and nothing inside it, so a real mismatch in the tree still reports.
 */
function ThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // The sign-in route renders without the shell, because there is nothing to
  // navigate to yet.
  if (!session) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body>
          <ThemeBoot />
          {children}
        </body>
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
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeBoot />
        <AppShell
          session={{ displayName: session.displayName, role: session.role }}
          nav={navForRole(session.role, { queue: queueCount })}
          mock={isMockMode()}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
