import { LegalPage, siteMetadata } from "@/site/pages";

export const dynamic = "force-static";
export const metadata = siteMetadata("es", "terms");

export default function Page() {
  return <LegalPage locale="es" doc="terms" />;
}
