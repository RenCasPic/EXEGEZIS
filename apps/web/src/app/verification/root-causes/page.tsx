import { Microscope } from "lucide-react";
import type { Metadata } from "next";
import { NotImplementedPage } from "@/components/investigation/not-implemented-page";

export const metadata: Metadata = { title: "Root causes" };

export default function RootCausesPage() {
  return (
    <NotImplementedPage
      title="Root Causes"
      description="Causes of verified bugs, each backed by an experiment."
      icon={<Microscope />}
      why="Nothing inspects code, logs or application state beyond the reproduction, so no cause has been proposed or validated for any investigation."
      requires={[
        "A hypothesis stated as a prediction that can be tested.",
        "An intervention experiment (mutation, controlled change or bisect) that confirms the prediction.",
        "A negative control, and alternative hypotheses ruled out.",
        "INSUFFICIENT EVIDENCE as a valid, visible outcome.",
      ]}
    />
  );
}
