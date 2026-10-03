import type { ReactNode } from "react";
import { SiteDocument } from "@/site/pages";

/** The public pages in Spanish (src/site): static, no session, no app data. */
export const dynamic = "force-static";

export default function SiteEsLayout({ children }: { children: ReactNode }) {
  return <SiteDocument locale="es">{children}</SiteDocument>;
}
