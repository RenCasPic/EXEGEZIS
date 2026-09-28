import type { SearchHit } from "@exegezis/core";
import { ExternalLink, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status";
import type { VisitShot } from "@/lib/evidence/searches";
import { placeKey, VERDICT_TONE } from "@/lib/search-labels";
import { artifactUrl } from "@/lib/urls";
import { ReviewButtons } from "./review-buttons";

/** The part of the full-page screenshot around the block, with the block outlined. */
function ShotCrop({ searchId, shot, rect }: { searchId: string; shot: VisitShot; rect: NonNullable<SearchHit["rect"]> }) {
  const t = useTranslations("searches.hit");
  const pad = 140;
  const y0 = Math.max(0, rect.y - pad);
  const h = Math.min(shot.height - y0, rect.height + pad * 2);
  if (h <= 0) return null;
  const href = artifactUrl(searchId, shot.path);
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-line bg-white" title={t("openShot")}>
      <svg viewBox={`0 ${y0} ${shot.width} ${h}`} className="block h-auto w-full" role="img" aria-label={t("shotAlt")}>
        <image href={href} x="0" y="0" width={shot.width} height={shot.height} />
        <rect x={rect.x - 4} y={rect.y - 4} width={rect.width + 8} height={rect.height + 8} fill="none" className="stroke-bad" strokeWidth="4" rx="4" />
      </svg>
    </a>
  );
}

/**
 * One search result. The quote, its context, the term, the selector and the
 * AI's reason are shown as recorded (the site's text is never translated;
 * the reason was requested in the language of the search).
 */
export function HitCard({ searchId, hit, runs, mark, shot, novelty }: { searchId: string; hit: SearchHit; runs: number; mark: string; shot: VisitShot | null; novelty: "new" | "same" | null }) {
  const t = useTranslations("searches");
  const labels = useTranslations("labels");
  const before = hit.quote.slice(0, hit.match.start);
  const matched = hit.quote.slice(hit.match.start, hit.match.end);
  const after = hit.quote.slice(hit.match.end);
  return (
    <article className="flex min-w-0 flex-col gap-3 border-b border-line px-4 py-3 last:border-b-0 md:flex-row" aria-label={t("hit.label", { text: hit.matchedText })}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={hit.verdict} tone={VERDICT_TONE[hit.verdict]} size="xs" title={`${t(`verdictHelp.${hit.verdict}`)} · ${labels("statusTitle", { code: hit.verdict })}`} />
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${hit.visible ? "border-line text-muted" : "border-warn/40 bg-warn-bg text-fg"}`}>
            {!hit.visible && <EyeOff className="size-3" aria-hidden />}
            {t(`place.${placeKey(hit)}`)}
          </span>
          {hit.via === "variant" && (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted" title={t("hit.variantTitle")}>
              {t("hit.variant", { stem: hit.stem ?? "" })}
            </span>
          )}
          {novelty === "new" && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent">{t("hit.new")}</span>}
          {hit.term !== null && (
            <span className="font-mono text-[11px] text-faint" translate="no">
              {hit.term}
            </span>
          )}
        </div>
        <blockquote className="text-[14px] leading-relaxed text-fg" translate="no">
          {hit.contextBefore !== "" && <span className="text-muted">…{hit.contextBefore}</span>}
          <span className="font-medium">
            {before}
            <mark className="rounded bg-warn-bg px-0.5 text-fg ring-1 ring-warn/40">{matched}</mark>
            {after}
          </span>
          {hit.contextAfter !== "" && <span className="text-muted">{hit.contextAfter}…</span>}
        </blockquote>
        {hit.reason !== null && (
          <p className="text-[12px] text-muted">
            {hit.relevance === null ? t("hit.reason") : t("hit.reasonRelevance", { relevance: labels(`relevance.${hit.relevance}`) })} <span translate="no">{hit.reason}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
          <a href={hit.textFragmentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
            {t("hit.openOnPage")} <ExternalLink className="size-3" aria-hidden />
          </a>
          <span>{t(`kind.${hit.blockKind}`)}</span>
          {hit.source === "exact" && <span title={t("hit.loadsTitle")}>{t("hit.loads", { seen: hit.occurrences.length, runs })}</span>}
          {hit.selector !== null && (
            <code className="max-w-full truncate font-mono text-[11px] text-faint" title={hit.selector}>
              {hit.selector}
            </code>
          )}
        </div>
        <ReviewButtons searchId={searchId} hitId={hit.id} mark={mark} />
      </div>
      <div className="w-full shrink-0 md:w-56">
        {hit.rect !== null && shot !== null ? (
          <ShotCrop searchId={searchId} shot={shot} rect={hit.rect} />
        ) : (
          <p className="rounded border border-dashed border-line px-2 py-3 text-center text-[12px] text-faint">{hit.visible ? t("hit.noShot") : t("hit.hiddenShot")}</p>
        )}
      </div>
    </article>
  );
}
