import { LandingPage, siteMetadata } from "@/site/pages";

export const dynamic = "force-static";
export const metadata = siteMetadata("en", "landing");

export default function Page() {
  return <LandingPage locale="en" />;
}
