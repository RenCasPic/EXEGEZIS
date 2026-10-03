"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { deleteInspectionAction } from "@/app/inspection-actions";
import { Button } from "@/components/ui/primitives";

/**
 * «Delete» (red), then a dialog over the page: «Delete this inspection? Yes /
 * Cancel». Nothing is deleted on the first click, and the table around the
 * button does not move.
 */
export function DeleteInspection({ id, site, from }: { id: string; site: string; from: "list" | "detail" }) {
  const t = useTranslations("inspections.delete");
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<"running" | "failed" | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    dialog.current?.close();
    setError(null);
  };

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => dialog.current?.showModal()} aria-label={t("label", { id })} title={t("button")}>
        <Trash2 aria-hidden />
        {from === "detail" && t("button")}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`delete-${id}-title`}
        onClose={() => setError(null)}
        className="m-auto w-[min(420px,calc(100vw-32px))] rounded-lg border border-line-strong bg-panel p-5 text-fg shadow-xl backdrop:bg-black/50"
      >
        <h2 id={`delete-${id}-title`} className="text-[15px] font-semibold">
          {t("confirm")}
        </h2>
        <p className="mt-2 break-all font-mono text-[12px] text-muted">{site}</p>
        <p className="font-mono text-[11px] text-faint">{id}</p>
        {error !== null && (
          <p role="alert" className="mt-3 text-[13px] text-bad">
            {t(error)}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={close} autoFocus>
            {t("no")}
          </Button>
          <Button
            variant="dangerSolid"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await deleteInspectionAction(id, from);
                setError(result);
                if (result === null) dialog.current?.close();
              })
            }
          >
            <Trash2 aria-hidden />
            {t("yes")}
          </Button>
        </div>
      </dialog>
    </>
  );
}
