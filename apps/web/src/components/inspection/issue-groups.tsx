import type { Finding, InspectionReport, IssueGroup } from "@exegezis/core";
import Link from "next/link";
import { SeverityLabel } from "@/components/inspection/severity";
import { VerdictPill } from "@/components/ui/status";
import { GROUP_VERDICT_TEXT, groupTitleEs } from "@/lib/issue-labels";
import { shortUrl } from "@/lib/inspection-labels";
import { artifactUrl } from "@/lib/urls";

const fmt = (n: number) => String(n).replace(".", ",");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A sample of text in the page's own colours (data from the report, not design tokens). */
function Swatch({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-8 w-12 place-items-center rounded border border-line-strong text-[15px] font-semibold" style={{ color: fg, background: bg }} aria-hidden>
        Aa
      </span>
      <span className="text-[12px] text-muted">{label}</span>
    </span>
  );
}

function selectorOf(f: Finding): string | null {
  const i = f.title.indexOf("): ");
  return f.checkId === "a11y" && i >= 0 ? f.title.slice(i + 3) : null;
}

function Example({ inspectionId, finding, origin }: { inspectionId: string; finding: Finding; origin: string }) {
  const shot = finding.evidence.find((e) => e.kind === "screenshot" && e.path.endsWith("axe-highlight.png")) ?? finding.evidence.find((e) => e.kind === "screenshot");
  const selector = selectorOf(finding);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-mono text-faint">{finding.id}</span>
        <span className="font-mono text-muted">{shortUrl(finding.page, origin)}</span>
        {finding.verdict !== "VERIFIED" && <VerdictPill verdict={finding.verdict} size="xs" />}
        <Link href={`?vista=elementos&q=${encodeURIComponent(finding.id)}`} className="ml-auto text-accent-text hover:underline">
          Ver el elemento
        </Link>
      </div>
      {selector !== null && <code className="font-mono text-[11px] break-all text-fg">{selector}</code>}
      {shot !== undefined && (
        <img
          src={artifactUrl(inspectionId, shot.path)}
          alt={`Captura de ${shortUrl(finding.page, origin)}${shot.path.endsWith("axe-highlight.png") ? " con los elementos afectados marcados" : ""}`}
          className="max-h-72 w-full rounded border border-line bg-white object-contain object-top"
          loading="lazy"
        />
      )}
    </li>
  );
}

export function IssueGroupItem({ inspectionId, group, report }: { inspectionId: string; group: IssueGroup; report: InspectionReport }) {
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  const examples = group.examples.map((id) => byId.get(id)).filter((f): f is Finding => f !== undefined);
  const specs = group.findings.filter((id) => byId.get(id)?.spec !== null).length;
  const c = group.contrast;
  return (
    <li className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-hover/40 [&::-webkit-details-marker]:hidden">
          <VerdictPill verdict={group.verdict} size="xs" title={GROUP_VERDICT_TEXT[group.verdict]} />
          <SeverityLabel severity={group.severity} />
          {c !== null && (
            <span className="grid h-6 w-9 shrink-0 place-items-center rounded border border-line-strong text-[12px] font-semibold" style={{ color: c.foreground, background: c.background }} aria-hidden>
              Aa
            </span>
          )}
          <span className="min-w-0 flex-1 basis-64 text-[13px] font-medium break-words text-fg">{groupTitleEs(group)}</span>
          <span className="font-mono text-[12px] whitespace-nowrap text-muted">
            {plural(group.elements, "elemento", "elementos")} · {plural(group.pages.length, "página", "páginas")}
            {group.intermittent > 0 && group.verified > 0 ? ` · ${group.intermittent} intermitente${group.intermittent === 1 ? "" : "s"}` : ""}
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line bg-panel-2 px-4 py-4">
          {group.verdict === "MIXED" && (
            <p className="text-[13px] text-fg">
              {group.verified} de {group.elements} elementos aparecen en todas las repeticiones; {group.intermittent} solo en algunas. Los intermitentes se marcan en cada ejemplo y en la vista por elemento.
            </p>
          )}
          {c !== null && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Swatch fg={c.foreground} bg={c.background} label={`Actual: ${c.foreground.toUpperCase()} sobre ${c.background.toUpperCase()} · ${fmt(c.ratio)}:1 (mínimo ${fmt(c.required)}:1${c.textSize === "large" ? ", texto grande" : ""})`} />
                {c.suggestion !== null && (
                  <Swatch fg={c.suggestion.color} bg={c.background} label={`Sugerencia, no verificada: ${c.suggestion.color.toUpperCase()} · ${fmt(c.suggestion.ratio)}:1`} />
                )}
              </div>
              {c.suggestion !== null && (
                <p className="text-[12px] text-muted">
                  La sugerencia es el color más cercano que cumple el mínimo cambiando solo la luminosidad (mismo tono y saturación). Está calculada, no comprobada en la página: revísala en tu diseño.
                </p>
              )}
            </div>
          )}
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted">Páginas afectadas ({group.pages.length})</h4>
            <ul className="flex flex-wrap gap-1.5">
              {group.pages.map((p) => (
                <li key={p} className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[12px] text-fg">
                  {shortUrl(p, report.target.origin)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-medium text-muted">
              Ejemplos ({examples.length} de {group.elements}) · {specs === 0 ? "sin spec" : `${specs} spec${specs === 1 ? "" : "s"} de Playwright, uno por elemento verificado`}
            </h4>
            <ul className="grid gap-3 lg:grid-cols-2">
              {examples.map((f) => (
                <Example key={f.id} inspectionId={inspectionId} finding={f} origin={report.target.origin} />
              ))}
            </ul>
          </div>
          <p className="font-mono text-[11px] text-faint">{group.id}</p>
        </div>
      </details>
    </li>
  );
}

export function IssueGroupList({ inspectionId, groups, report, empty }: { inspectionId: string; groups: IssueGroup[]; report: InspectionReport; empty: string }) {
  if (groups.length === 0) return <p className="px-4 py-6 text-[13px] text-muted">{empty}</p>;
  return (
    <ul>
      {groups.map((g) => (
        <IssueGroupItem key={g.id} inspectionId={inspectionId} group={g} report={report} />
      ))}
    </ul>
  );
}
