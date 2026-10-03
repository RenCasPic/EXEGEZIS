"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sameOrigin } from "@/lib/account";
import { deleteInspection } from "@/lib/delete-inspection";

/** «Delete» on the list or on an inspection's page. null: deleted (from its page, back to the list); otherwise why not. */
export async function deleteInspectionAction(id: string, from: "list" | "detail"): Promise<"running" | "failed" | null> {
  if (!(await sameOrigin())) return "failed";
  const result = await deleteInspection(id);
  if (result === "running") return "running";
  if (result === "notFound") return "failed";
  revalidatePath("/inspections");
  if (from === "detail") redirect("/inspections");
  return null;
}
