import { useTranslations } from "next-intl";
import { InspectForm } from "./inspect-form";
import { Container } from "./ui";

/** The closing call: navy with a lime outline. */
export function FinalCta() {
  const t = useTranslations("cta");
  return (
    <section aria-labelledby="cta-title" className="py-16 sm:py-24">
      <Container>
        <div className="theme-dark panel-frame flex flex-col items-center gap-5 rounded-2xl px-5 py-12 text-center sm:px-12">
          <h2 id="cta-title" className="max-w-2xl text-[26px] leading-tight font-semibold tracking-tight text-heading sm:text-[36px]">
            {t("title")}
          </h2>
          <p className="max-w-xl text-[16px] text-heading">{t("text")}</p>
          <div className="w-full max-w-xl">
            <InspectForm size="md" />
          </div>
        </div>
      </Container>
    </section>
  );
}
