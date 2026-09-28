import type { BlockInfo } from "@exegezis/core";
import { AppWindow, RotateCw, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { accessDoneAction, openAccessWindowAction, relaunchInspectionAction } from "@/app/access-actions";
import { HttpAuthForm, WafTokenForm } from "@/components/access/forms";
import { buttonClass } from "@/components/ui/primitives";
import { EngineText } from "@/components/ui/engine-text";
import { BLOCK_SOLUTIONS, WINDOW_BUTTON_KINDS } from "@/lib/block-labels";
import { artifactUrl } from "@/lib/urls";

/**
 * The block of an inspection, in plain language, with its evidence and the
 * button of its legitimate solution (docs/09-access.md §5).
 */
export function BlockNotice({
  block,
  origin,
  inspectionId,
  relaunchJobId,
  hasWafToken,
}: {
  block: BlockInfo;
  origin: string;
  /** For the evidence screenshot link. */
  inspectionId: string | null;
  /** The inspection job to run again once the access is fixed. */
  relaunchJobId: string | null;
  hasWafToken: boolean;
}) {
  const t = useTranslations("access");
  const e = block.evidence;
  const solutions = BLOCK_SOLUTIONS[block.kind];
  const headers = Object.entries(e.headers);
  return (
    <section role="alert" aria-labelledby="block-title" className="flex flex-col gap-3 rounded-lg border border-warn/30 bg-warn-bg p-4 text-[13px] text-fg">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <h2 id="block-title" className="text-[14px] font-semibold text-heading">
            {t(`block.${block.kind}.title`)} <span className="font-mono text-[11px] font-normal text-muted">({block.kind})</span>
          </h2>
          <p className="mt-0.5 text-fg">{t(`block.${block.kind}.explanation`)}</p>
          <p className="mt-1 text-[12px] text-muted">{t("notice.noConclusion")}</p>
        </div>
      </div>

      <details className="rounded-md border border-line bg-panel">
        <summary className="cursor-pointer px-3 py-2 text-[12px] text-muted hover:text-fg">{t("notice.evidence")}</summary>
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2 font-mono text-[11px] break-all text-muted">
          <EngineText message={block.message} text={block.detail} />
          {e.finalUrl !== null && <span>
              {t("notice.finalUrl")} <span translate="no">{e.finalUrl}</span>
            </span>}
          {e.httpStatus !== null && <span>HTTP {e.httpStatus}</span>}
          {headers.length > 0 && <span>
              {t("notice.headers")} <span translate="no">{headers.map(([k, v]) => `${k}: ${v}`).join(" · ")}</span>
            </span>}
          {e.markers.length > 0 && <span>
              {t("notice.markers")} <span translate="no">{e.markers.join(", ")}</span>
            </span>}
          {e.cookieNames.length > 0 && <span>
              {t("notice.cookies")} <span translate="no">{e.cookieNames.join(", ")}</span>
            </span>}
          {block.retryAfterSeconds !== null && <span>{t.rich("notice.retryAfter", { seconds: block.retryAfterSeconds })}</span>}
          {e.screenshot !== null && inspectionId !== null && (
            <img src={artifactUrl(inspectionId, e.screenshot)} alt={t("notice.screenshotAlt")} className="max-h-64 w-full rounded border border-line bg-white object-contain object-top" loading="lazy" />
          )}
        </div>
      </details>

      <div className="flex flex-col gap-3">
        {solutions.includes("window") && (
          <form action={openAccessWindowAction} className="flex flex-col gap-2">
            <input type="hidden" name="url" value={e.finalUrl !== null && block.kind !== "LOGIN_WALL" && block.kind !== "SESSION_EXPIRED" ? e.finalUrl : `${origin}/`} />
            <input type="hidden" name="block" value={block.kind} />
            {relaunchJobId !== null && <input type="hidden" name="relaunch" value={relaunchJobId} />}
            {block.kind === "BOT_CHALLENGE" && (
              <label className="flex items-start gap-2 text-[12px] text-fg">
                <input type="checkbox" name="permission" required className="mt-0.5 size-4 accent-[var(--accent)]" />
                {t("notice.permission")}
              </label>
            )}
            <button type="submit" className={`${buttonClass("primary")} self-start`}>
              <AppWindow aria-hidden /> {WINDOW_BUTTON_KINDS.includes(block.kind) ? t(`block.${block.kind}.window` as "block.LOGIN_WALL.window") : t("notice.openWindow")}
            </button>
            <p className="text-[12px] text-muted">
              {t("notice.windowHelp")}
              {relaunchJobId !== null ? ` ${t("notice.windowRelaunch")}` : ""}
            </p>
          </form>
        )}
        {solutions.includes("http-auth") && <HttpAuthForm url={`${origin}/`} {...(relaunchJobId === null ? {} : { relaunch: relaunchJobId })} />}
        {solutions.includes("waf-token") && (
          <details className="rounded-md border border-line bg-panel" open={block.kind === "BOT_CHALLENGE"}>
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-fg">{t("notice.wafSummary")}</summary>
            <div className="border-t border-line px-3 py-3">
              <WafTokenForm url={`${origin}/`} hasToken={hasWafToken} />
            </div>
          </details>
        )}
        {solutions.includes("relaunch") && relaunchJobId !== null && (
          <form action={relaunchInspectionAction}>
            <input type="hidden" name="relaunch" value={relaunchJobId} />
            <button type="submit" className={buttonClass("secondary")}>
              <RotateCw aria-hidden /> {block.retryAfterSeconds !== null ? t("notice.relaunchWait", { seconds: block.retryAfterSeconds }) : t("notice.relaunch")}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

/** The "Listo" button of an access window. */
export function AccessDoneButton({ jobId }: { jobId: string }) {
  const t = useTranslations("access.notice");
  return (
    <form action={accessDoneAction}>
      <input type="hidden" name="job" value={jobId} />
      <button type="submit" className={buttonClass("primary")}>
        {t("done")}
      </button>
    </form>
  );
}
