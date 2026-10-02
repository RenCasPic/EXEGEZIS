import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container, SectionHeading } from "./ui";

const QUESTIONS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

/** FAQ: native disclosure widgets (keyboard and screen readers work without script). */
export function Faq() {
  const t = useTranslations("faq");
  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-line bg-panel py-16 sm:py-24">
      <Container className="max-w-3xl">
        <SectionHeading id="faq-title" eyebrow={t("eyebrow")} title={t("title")} />
        <div className="panel-frame divide-y divide-line overflow-hidden rounded-xl bg-panel">
          {QUESTIONS.map((q) => (
            <details key={q} className="group">
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-[16px] font-semibold text-heading hover:bg-hover">
                <h3>{t(`${q}.q`)}</h3>
                <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-5 pb-5 text-[15px] leading-relaxed text-muted">{t(`${q}.a`)}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
