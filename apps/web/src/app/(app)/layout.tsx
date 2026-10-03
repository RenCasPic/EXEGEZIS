import type { ReactNode } from "react";
import { AppDocument, appMetadata } from "@/components/app-shell/document";
import { AppShell } from "@/components/app-shell/shell";

export const generateMetadata = appMetadata;

// Every app page reads the run directories (and, in cloud mode, the session) at request time.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppDocument>
      <AppShell>{children}</AppShell>
    </AppDocument>
  );
}
