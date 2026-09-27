import type { EngineMessage, MessageParam } from "@exegezis/core";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

type Translate = ReturnType<typeof useTranslations<"engine">>;
type Labels = ReturnType<typeof useTranslations<"labels">>;

/** A message in the reader's language: nested messages first, lists joined with «; », technical codes as labels. */
export function translateEngine(t: Translate, labels: Labels, m: EngineMessage): string | null {
  const key = m.code as never;
  if (!t.has(key)) return null;
  const value = (p: MessageParam): string | number => {
    if (typeof p === "number") return p;
    if (typeof p === "string") {
      const status = `status.${p}` as "status.OK";
      return /^[A-Z][A-Z0-9_]+$/.test(p) && labels.has(status) ? labels(status) : p;
    }
    if (Array.isArray(p)) return p.map((x) => translateEngine(t, labels, x) ?? x.code).join("; ");
    return translateEngine(t, labels, p) ?? p.code;
  };
  const values = Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, value(v)]));
  return t(key, values as never);
}

/**
 * A text the engine produced (a reason, a block's detail, an error). The
 * engine records a code and its parameters, and the UI translates them. An
 * older report may only have the English sentence: it is shown as recorded,
 * labelled «(original)», never passed off as a translation.
 */
export function EngineText({ message, text, className }: { message?: EngineMessage | null | undefined; text: string | null | undefined; className?: string }) {
  const t = useTranslations("engine");
  const labels = useTranslations("labels");
  const translated = message === null || message === undefined ? null : translateEngine(t, labels, message);
  if (translated !== null) return <span className={className}>{translated}</span>;
  if (text === null || text === undefined || text.trim() === "") return null;
  return (
    <span className={cn(className)}>
      <span translate="no">{text}</span>{" "}
      <span className="text-[11px] text-faint" title={labels("originalTitle")}>
        {labels("original")}
      </span>
    </span>
  );
}
