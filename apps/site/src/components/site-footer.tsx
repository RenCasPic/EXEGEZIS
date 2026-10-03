import { useLocale, useTranslations } from "next-intl";
import { LEGAL_SLUGS } from "@content/legal";
import { Container } from "./ui";

/** Footer on white. Pages that do not exist yet are plain text marked «coming soon», not empty links. */
export function SiteFooter() {
  const t = useTranslations("footer");
  const locale = useLocale() === "es" ? "es" : "en";
  const home = `/${locale}/`;
  const product = [
    ["inspections", `${home}#product`],
    ["searches", `${home}#product`],
    ["bugs", `${home}#product`],
    ["pricing", `${home}#pricing`],
  ] as const;
  // TODO: documentation, how we verify, what's new and responsible use, once they exist.
  const pending = {
    resources: ["docs", "howWeVerify", "news"],
    legal: ["responsible"],
  } as const;
  // The legal texts exist as drafts (pending legal review).
  const legal = [
    ["privacyPage", `/${locale}/${LEGAL_SLUGS.privacy[locale]}/`],
    ["termsPage", `/${locale}/${LEGAL_SLUGS.terms[locale]}/`],
  ] as const;
  return (
    <footer className="mt-16 border-t border-line bg-panel py-12 text-[14px] md:mt-24">
      <Container className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[15px] font-semibold tracking-[0.16em] text-heading">EXEGEZIS</span>
          <p className="leading-[1.5] text-muted">{t("tagline")}</p>
          <p className="text-muted">{t("copyright")}</p>
        </div>
        <nav aria-labelledby="footer-product" className="flex flex-col gap-2.5">
          <h2 id="footer-product" className="font-semibold text-heading">
            {t("product")}
          </h2>
          {product.map(([key, href]) => (
            <a key={key} href={href} className="text-heading hover:underline">
              {t(key)}
            </a>
          ))}
        </nav>
        {(["resources", "legal"] as const).map((group) => (
          <div key={group} className="flex flex-col gap-2.5">
            <h2 className="font-semibold text-heading">{t(group)}</h2>
            {group === "legal" &&
              legal.map(([key, href]) => (
                <a key={key} href={href} className="text-heading hover:underline">
                  {t(key)}
                </a>
              ))}
            {pending[group].map((key) => (
              <p key={key} className="text-heading">
                {t(key)} <span className="text-[12px] text-muted">{t("soon")}</span>
              </p>
            ))}
          </div>
        ))}
      </Container>
    </footer>
  );
}
