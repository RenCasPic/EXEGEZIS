"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { deleteInspectionAction } from "@/app/inspection-actions";
import { Button } from "@/components/ui/primitives";

/** «Delete», then «Delete it? Yes / Cancel»: nothing is deleted on the first click. */
export function DeleteInspection({ id, from }: { id: string; from: "list" | "detail" }) {
  const t = useTranslations("inspections.delete");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<"running" | "failed" | null>(null);
  const [pending, start] = useTransition();

  if (!asking) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAsking(true)} aria-label={t("label", { id })} title={t("button")}>
        <Trash2 aria-hidden />
        {from === "detail" && t("button")}
      </Button>
    );
  }
  return (
    <span role="group" aria-label={t("label", { id })} className={`inline-flex items-center justify-end gap-2 ${from === "list" ? "whitespace-nowrap" : "flex-wrap"}`}>
      <span className="text-[12px] text-muted">{from === "list" ? t("confirmShort") : t("confirm")}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        className="text-bad"
        onClick={() =>
          start(async () => {
            setError(await deleteInspectionAction(id, from));
          })
        }
      >
        {t("yes")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          setAsking(false);
          setError(null);
        }}
      >
        {t("no")}
      </Button>
      {error !== null && (
        <span role="alert" className="basis-full whitespace-normal text-right text-[12px] text-bad">
          {t(error)}
        </span>
      )}
    </span>
  );
}
