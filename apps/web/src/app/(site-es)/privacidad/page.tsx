import { LegalPage, siteMetadata } from "@/site/pages";

export const dynamic = "force-static";
export const metadata = siteMetadata("es", "privacy");

export default function Page() {
  return <LegalPage locale="es" doc="privacy" />;
}
