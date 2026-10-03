import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {eyebrow !== undefined && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight text-heading">{title}</h1>
        {description !== undefined && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  icon,
  actions,
  children,
  id,
  className,
  bodyClassName,
  subtitle,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  subtitle?: ReactNode;
}) {
  return (
    <section id={id} className={cn("panel-frame min-w-0 scroll-mt-20 rounded-lg bg-panel", className)}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon !== undefined && <span className="text-muted [&>svg]:size-4">{icon}</span>}
          <h2 className="text-[13px] font-semibold tracking-tight text-heading">{title}</h2>
          {subtitle !== undefined && <span className="truncate text-xs text-faint">{subtitle}</span>}
        </div>
        {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, footer }: { label: string; value: ReactNode; hint?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="panel-frame flex flex-col gap-1 rounded-lg bg-panel px-4 py-3.5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="font-mono text-[26px] leading-tight font-semibold tracking-tight text-fg">{value}</div>
      {hint !== undefined && <div className="text-xs text-faint">{hint}</div>}
      {footer}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon !== undefined && <div className="mb-1 text-faint [&>svg]:size-6">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {children !== undefined && <div className="max-w-full text-sm text-muted [overflow-wrap:anywhere] sm:max-w-md">{children}</div>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

const BUTTON = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover border border-transparent",
  secondary: "bg-panel-2 text-fg border border-line-strong hover:bg-hover",
  ghost: "text-muted hover:text-fg hover:bg-hover border border-transparent",
  /** Something that deletes: red, so it is never taken for an ordinary button. */
  danger: "bg-bad-bg text-bad border border-bad/40 hover:border-bad",
  /** The confirmation of a deletion. */
  dangerSolid: "bg-bad text-bg border border-transparent hover:opacity-90",
} as const;

export function buttonClass(variant: keyof typeof BUTTON = "secondary", size: "sm" | "md" = "md"): string {
  return cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-3.5",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
    BUTTON[variant],
  );
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: keyof typeof BUTTON; size?: "sm" | "md" }) {
  return <button type="button" className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof BUTTON; size?: "sm" | "md" }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-panel-2 px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

/** Definition list used for metadata blocks. */
export function Meta({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[13px]", className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px]", className)}>{children}</span>;
}

/** Link-based tabs: the active tab lives in the URL, so every view is linkable and server-rendered. */
export function TabLinks({ tabs, active }: { tabs: { id: string; label: string; href: string; count?: number | null }[]; active: string }) {
  const t = useTranslations("common");
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-line px-2" aria-label={t("tabs")}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          scroll={false}
          aria-current={tab.id === active ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] transition-colors",
            tab.id === active ? "border-accent-text text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null && <span className="rounded bg-panel-2 px-1 font-mono text-[10px] text-faint">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function CodeBlock({ code, className, lineNumbers = true, maxHeight = "32rem" }: { code: string; className?: string; lineNumbers?: boolean; maxHeight?: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  const width = String(lines.length).length;
  return (
    <pre className={cn("overflow-auto rounded-md border border-line bg-code py-3 font-mono text-[12px] leading-5", className)} style={{ maxHeight }}>
      <code>
        {lines.map((line, i) => (
          <div key={i} className="flex px-3 hover:bg-hover/60">
            {lineNumbers && (
              <span className="mr-4 shrink-0 select-none text-right text-faint" style={{ width: `${width}ch` }}>
                {i + 1}
              </span>
            )}
            <span className="whitespace-pre text-fg">{line === "" ? " " : line}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}

export const tableClass = {
  /** Scrolls sideways when it must, with fading edges that say so. */
  wrap: "scroll-hint overflow-x-auto",
  table: "w-full border-collapse text-left text-[13px]",
  th: "sticky top-0 whitespace-nowrap border-b border-line bg-panel px-3 py-2 text-[11px] font-medium text-faint",
  tr: "border-b border-line last:border-b-0 hover:bg-hover/50",
  td: "px-3 py-2.5 align-middle",
};
