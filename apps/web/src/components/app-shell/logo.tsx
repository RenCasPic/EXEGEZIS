/** The EXEGEZIS mark: three lines of text, the middle one annotated. */
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
