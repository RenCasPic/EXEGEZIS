import { Bug, KeyRound, ScanSearch, TextSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container, SectionHeading } from "./ui";

const TOOLS = [
  ["inspect", ScanSearch],
  ["search", TextSearch],
  ["verify", Bug],
  ["private", KeyRound],
] as const;

/** What it does: four tools, three points each. */
export function Features() {
  const t = useTranslations("features");
  return (
    <section id="product" aria-labelledby="product-title" className="py-16 sm:py-24">
      <Container>
        <SectionHeading id="product-title" eyebrow={t("eyebrow")} title={t("title")} />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLS.map(([key, Icon]) => (
            <li key={key} className="panel-frame flex flex-col gap-4 rounded-xl bg-panel p-5">
              <Icon className="size-6 text-accent-text" aria-hidden />
              <h3 className="text-[18px] font-semibold text-heading">{t(`${key}.title`)}</h3>
              <ul className="flex flex-col gap-2.5 text-[14px] leading-snug text-muted">
                {(["p1", "p2", "p3"] as const).map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                    {t(`${key}.${p}`)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
