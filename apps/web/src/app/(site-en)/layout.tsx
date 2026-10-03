import type { ReactNode } from "react";
import { SiteDocument } from "@/site/pages";

/** The public pages in English (src/site): static, no session, no app data. */
export const dynamic = "force-static";

export default function SiteEnLayout({ children }: { children: ReactNode }) {
  return <SiteDocument locale="en">{children}</SiteDocument>;
}
