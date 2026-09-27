import { useTranslations } from "next-intl";
import type { StageDetail } from "@/lib/evidence/stages";
import { EngineText } from "@/components/ui/engine-text";

/** A stage's detail in the reader's language (recorded content stays as written). */
export function StageDetailText({ detail }: { detail: StageDetail }) {
  const t = useTranslations("common.stageDetail");
  const status = useTranslations("labels.status");
  if (detail.kind === "content") return <span translate="no">{detail.text}</span>;
  if (detail.kind === "engine")
    return (
      <>
        {detail.failures !== undefined && detail.attempts !== undefined && <>{t("runsFailed", { failures: detail.failures, attempts: detail.attempts })} </>}
        <EngineText message={detail.message} text={detail.text} />
      </>
    );
  const values = { ...(detail.values ?? {}) };
  if (typeof values["outcome"] === "string") values["outcome"] = status(values["outcome"] as "OK");
  return <>{t(detail.key, values as never)}</>;
}

/** Plain text of a stage's detail, for tooltips. */
export function useStageDetailText(): (detail: StageDetail) => string {
  const t = useTranslations("common.stageDetail");
  const status = useTranslations("labels.status");
  return (detail) => {
    if (detail.kind === "content") return detail.text;
    if (detail.kind === "engine") return detail.text ?? "";
    const values = { ...(detail.values ?? {}) };
    if (typeof values["outcome"] === "string") values["outcome"] = status(values["outcome"] as "OK");
    return t(detail.key, values as never);
  };
}
