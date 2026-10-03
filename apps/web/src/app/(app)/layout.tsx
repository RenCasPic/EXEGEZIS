import type { ReactNode } from "react";
import { AppDocument, appMetadata } from "@/components/app-shell/document";

export const generateMetadata = appMetadata;

// Every app page reads the session and the user's run directories at request time.
export const dynamic = "force-dynamic";

/** The root of the app's pages; the shell (sidebar, top bar) and the 404 are one level down, in (shell). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppDocument>{children}</AppDocument>;
}
