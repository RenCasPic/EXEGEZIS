import type { ReactNode } from "react";
import { AppDocument, appMetadata } from "@/components/app-shell/document";

export const generateMetadata = appMetadata;

// Every app page reads the run directories (and, in cloud mode, the session) at request time.
export const dynamic = "force-dynamic";

/** `/`: the app's home (its own header). In cloud mode, a visitor without a session sees the landing instead (proxy.ts). */
export default function HomeLayout({ children }: { children: ReactNode }) {
  return <AppDocument>{children}</AppDocument>;
}
