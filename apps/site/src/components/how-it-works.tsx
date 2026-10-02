import { useTranslations } from "next-intl";
import { Container, SectionHeading } from "./ui";

/** How it works: three steps. */
export function HowItWorks() {
  const t = useTranslations("how");
  return (
    <section id="how" aria-labelledby="how-title" className="border-y border-line bg-panel py-16 sm:py-24">
      <Container>
        <SectionHeading id="how-title" eyebrow={t("eyebrow")} title={t("title")} />
        <ol className="grid gap-5 md:grid-cols-3">
          {(["step1", "step2", "step3"] as const).map((step, i) => (
            <li key={step} className="panel-frame flex flex-col gap-3 rounded-xl bg-panel p-5">
              <span className="grid size-9 place-items-center rounded-full bg-accent font-mono text-[15px] font-semibold text-on-accent" aria-hidden>
                {i + 1}
              </span>
              <h3 className="text-[18px] font-semibold text-heading">{t(`${step}.title`)}</h3>
              <p className="text-[14px] leading-relaxed text-muted">{t(`${step}.text`)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
