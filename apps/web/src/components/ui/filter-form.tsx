"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useTransition } from "react";
import { FILTER_DEBOUNCE_MS, filterHref } from "@/lib/filter-query";

/**
 * Filters live in the URL. Selects apply as soon as they change; the text
 * field applies while typing (after a short pause), on Enter and when it
 * loses focus. Without JavaScript the form still submits as a plain GET.
 */
export function FilterForm({
  selects,
  textLabel,
  placeholder,
  hidden = {},
}: {
  selects: { name: string; label: string; options: { value: string; label: string }[] }[];
  textLabel?: string;
  placeholder?: string;
  /** Other URL parameters the form keeps (e.g. the active status tab). */
  hidden?: Record<string, string>;
}) {
  const t = useTranslations("common.filter");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  const apply = () => {
    cancel();
    if (form.current === null) return;
    const href = filterHref(pathname, new FormData(form.current), params.toString());
    if (href !== null) start(() => router.replace(href, { scroll: false }));
  };
  const applySoon = () => {
    cancel();
    timer.current = setTimeout(apply, FILTER_DEBOUNCE_MS);
  };

  return (
    <form
      ref={form}
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="flex flex-wrap items-end gap-2"
      aria-busy={pending}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {selects.map((s) => (
        <label key={s.name} className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">
          {s.label}
          <select name={s.name} defaultValue={params.get(s.name) ?? ""} onChange={apply} className="h-8 max-w-[14rem] rounded-md border border-line-strong bg-panel px-2 text-[13px] text-fg">
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] text-muted">
        {textLabel ?? t("search")}
        <span className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <input type="search" name="q" defaultValue={params.get("q") ?? ""} placeholder={placeholder} onChange={applySoon} onBlur={apply} className="h-8 w-full rounded-md border border-line-strong bg-panel pr-2 pl-7 text-[13px] text-fg" />
        </span>
      </label>
    </form>
  );
}
