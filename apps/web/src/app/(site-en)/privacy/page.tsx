import { LegalPage, siteMetadata } from "@/site/pages";

export const dynamic = "force-static";
export const metadata = siteMetadata("en", "privacy");

export default function Page() {
  return <LegalPage locale="en" doc="privacy" />;
}
