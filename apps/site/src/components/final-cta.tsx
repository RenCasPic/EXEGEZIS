import { useTranslations } from "next-intl";
import { HERO_URL_ID } from "./inspect-form";
import { Container, LIME_BUTTON } from "./ui";

/** The closing call: a navy card with a lime outline; its button goes back to the hero's address field. */
export function FinalCta() {
  const t = useTranslations("cta");
  const inspect = useTranslations("inspect");
  return (
    <section aria-labelledby="cta-title" className="pt-[72px] md:pt-[112px]">
      <Container>
        <div className="theme-dark flex flex-col items-start gap-8 rounded-[20px] border-[1.5px] border-panel-border bg-bg p-8 text-heading md:flex-row md:items-center md:justify-between md:gap-12 md:p-16">
          <div className="flex max-w-[720px] flex-col gap-[14px]">
            <h2 id="cta-title" className="text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] md:text-[40px]">
              {t("title")}
            </h2>
            <p className="text-[18px] leading-[1.5] text-text-soft">{t("text")}</p>
          </div>
          <a href={`#${HERO_URL_ID}`} className={`${LIME_BUTTON} h-[58px] shrink-0 rounded-xl px-[30px] text-[17px] font-bold`}>
            {inspect("submit")}
          </a>
        </div>
      </Container>
    </section>
  );
}
