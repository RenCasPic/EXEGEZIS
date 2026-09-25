import { GitPullRequestDraft } from "lucide-react";
import type { Metadata } from "next";
import { NotImplementedPage } from "@/components/investigation/not-implemented-page";

export const metadata: Metadata = { title: "Fixes" };

export default function FixesPage() {
  return (
    <NotImplementedPage
      title="Fixes"
      description="Proposed code changes and their before/after verification."
      icon={<GitPullRequestDraft />}
      why="EXEGEZIS has not proposed or applied any code change, and no fix has been verified."
      requires={[
        "A validated root cause to fix.",
        "A proposed change, reviewed by a person.",
        "The same reproduction passing after the change (before: fails, after: passes).",
        "The regression suite passing, with the reproduction added as a regression test.",
      ]}
    />
  );
}
