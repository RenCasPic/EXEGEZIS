import { useTranslations } from "next-intl";
import { Container, Eyebrow } from "./ui";

const QUESTIONS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

/** FAQ: the heading on the left (420 px), every question with its answer open on the right. */
export function Faq() {
  const t = useTranslations("faq");
  return (
    <section id="faq" aria-labelledby="faq-title" className="pt-[72px] md:pt-[112px]">
      <Container className="grid grid-cols-1 gap-8 lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-16">
        <div className="flex flex-col gap-[14px]">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h2 id="faq-title" className="text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] text-heading md:text-[44px]">
            {t("title")}
          </h2>
        </div>
        <dl className="flex flex-col">
          {QUESTIONS.map((q) => (
            <div key={q} className="flex flex-col gap-2 border-b border-rule py-[22px]">
              <dt className="text-[18px] font-semibold text-heading">{t(`${q}.q`)}</dt>
              <dd className="text-[16px] leading-[1.55] text-muted">{t(`${q}.a`)}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
