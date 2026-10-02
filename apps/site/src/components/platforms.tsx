import { AppWindow, Globe, Monitor, Puzzle, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container, SectionHeading, SoonBadge } from "./ui";

const PLATFORMS = [
  ["web", Globe, true],
  ["apis", AppWindow, false],
  ["mobile", Smartphone, false],
  ["plugins", Puzzle, false],
  ["desktop", Monitor, false],
] as const;

/** Platforms: the web today; the rest, coming soon (dashed outline). */
export function Platforms() {
  const t = useTranslations("platforms");
  return (
    <section aria-labelledby="platforms-title" className="border-y border-line bg-panel py-16 sm:py-24">
      <Container>
        <SectionHeading id="platforms-title" eyebrow={t("eyebrow")} title={t("title")} />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PLATFORMS.map(([key, Icon, available]) => (
            <li
              key={key}
              className={`flex flex-col gap-3 rounded-xl p-5 ${available ? "panel-frame bg-panel" : "border-[1.5px] border-dashed border-line-strong bg-sunken"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <Icon className={`size-6 ${available ? "text-accent-text" : "text-muted"}`} aria-hidden />
                {available ? (
                  <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-semibold text-ok">{t("available")}</span>
                ) : (
                  <SoonBadge>{t("soon")}</SoonBadge>
                )}
              </div>
              <h3 className="text-[16px] font-semibold text-heading">{t(`${key}.name`)}</h3>
              <p className="text-[13px] leading-snug text-muted">{t(`${key}.detail`)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
