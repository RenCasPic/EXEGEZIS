import type { ReactNode } from "react";

/** The EXEGEZIS mark (the same shape as the local app's). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x="6" y="6.5" width="12" height="1.8" rx="0.9" fill="currentColor" />
      <rect x="6" y="11.1" width="7.5" height="1.8" rx="0.9" fill="var(--accent)" />
      <circle cx="16.6" cy="12" r="1.35" fill="var(--accent)" />
      <rect x="6" y="15.7" width="12" height="1.8" rx="0.9" fill="currentColor" />
    </svg>
  );
}

/** Section label in Geist Mono, uppercase (as written in the catalogs): link blue on the light body, lime on navy. */
export function Eyebrow({ children, onNavy = false }: { children: ReactNode; onNavy?: boolean }) {
  return <p className={`font-mono text-[12px] font-semibold tracking-[0.14em] ${onNavy ? "text-fg" : "text-accent-text"}`}>{children}</p>;
}

export function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: ReactNode; title: ReactNode }) {
  return (
    <div className="mb-8 flex max-w-3xl flex-col gap-2 sm:mb-10">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="text-[26px] leading-tight font-semibold tracking-tight text-heading sm:text-[34px]">
        {title}
      </h2>
    </div>
  );
}

/** «Coming soon»: what EXEGEZIS does not do yet. Never shown as available. */
export function SoonBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted">
      {children}
    </span>
  );
}

const BUTTON = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  outline: "border border-current text-accent-text hover:bg-hover",
} as const;

export function buttonClass(variant: keyof typeof BUTTON = "primary", size: "md" | "lg" = "md"): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors",
    size === "lg" ? "h-12 px-5 text-[15px]" : "h-10 px-4 text-[14px]",
    BUTTON[variant],
  ].join(" ");
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}
