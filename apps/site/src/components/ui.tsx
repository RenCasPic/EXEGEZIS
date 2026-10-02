import type { ReactNode } from "react";

/*
 * Shared pieces of the landing (docs/design/landing.html). Sizes are the
 * design's, in px; colours come from the tokens (packages/design-tokens).
 */

/** The EXEGEZIS mark of the design: a page with three lines. Lime on navy. */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 8h8" />
      <path d="M8 12h5" />
      <path d="M8 16h8" />
    </svg>
  );
}

/** The check of lists and guarantees. */
export function CheckIcon({ className = "size-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function GlobeIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/** Section label in Geist Mono: link blue on the light body, lime on navy. */
export function Eyebrow({ children, onNavy = false }: { children: ReactNode; onNavy?: boolean }) {
  return <p className={`font-mono text-[13px] tracking-[0.14em] ${onNavy ? "text-fg" : "text-accent-text"}`}>{children}</p>;
}

/** Label + h2 of a section (gap 14, max 760 px wide, 44 px title). */
export function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: ReactNode; title: ReactNode }) {
  return (
    <div className="flex max-w-[760px] flex-col gap-[14px]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] text-heading md:text-[44px]">
        {title}
      </h2>
    </div>
  );
}

/** «Coming soon»: what EXEGEZIS does not do yet. Never shown as available. */
export function SoonBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex shrink-0 items-center rounded-full bg-q-bg px-2 py-px text-[11px] font-semibold whitespace-nowrap text-q">{children}</span>;
}

/** The lime button of the navy bands (Start for free, Inspect for free). */
export const LIME_BUTTON = "inline-flex items-center justify-center whitespace-nowrap bg-accent text-on-accent hover:bg-accent-hover hover:no-underline";

/** The design's 1440 px frame: 80 px gutters at full width, 20 px on a phone. */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1440px] px-5 sm:px-10 xl:px-20 ${className}`}>{children}</div>;
}

/** A section of the light body: 112 px above (72 on a phone), heading, then its content. */
export function Section({ id, labelledBy, gap = 40, children }: { id?: string; labelledBy: string; gap?: 40 | 48; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="pt-[72px] md:pt-[112px]">
      <Container className={`flex flex-col ${gap === 48 ? "gap-10 md:gap-12" : "gap-8 md:gap-10"}`}>{children}</Container>
    </section>
  );
}
