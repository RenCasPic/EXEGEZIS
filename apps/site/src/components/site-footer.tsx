import { useTranslations } from "next-intl";
import { Container, LogoMark } from "./ui";

/** Footer. Pages that do not exist yet are plain text marked «coming soon», not empty links. */
export function SiteFooter() {
  const t = useTranslations("footer");
  const product = [
    ["inspections", "#product"],
    ["searches", "#product"],
    ["bugs", "#product"],
    ["pricing", "#pricing"],
  ] as const;
  // TODO: documentation, how we verify, what's new and the legal pages, once they exist.
  const pending = {
    resources: ["docs", "howWeVerify", "news"],
    legal: ["privacy", "terms", "responsible"],
  } as const;
  return (
    <footer className="border-t border-line bg-panel py-12">
      <Container className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-heading">
            <LogoMark className="size-7" />
            <span className="font-mono text-[14px] font-semibold tracking-[0.18em]">EXEGEZIS</span>
          </div>
          <p className="max-w-xs text-[14px] text-muted">{t("tagline")}</p>
        </div>
        <nav aria-labelledby="footer-product">
          <h2 id="footer-product" className="mb-3 text-[13px] font-semibold text-heading">
            {t("product")}
          </h2>
          <ul className="flex flex-col gap-2 text-[14px]">
            {product.map(([key, href]) => (
              <li key={key}>
                <a href={href} className="text-accent-text hover:underline">
                  {t(key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {(["resources", "legal"] as const).map((group) => (
          <div key={group}>
            <h2 className="mb-3 text-[13px] font-semibold text-heading">{t(group)}</h2>
            <ul className="flex flex-col gap-2 text-[14px] text-muted">
              {pending[group].map((key) => (
                <li key={key}>
                  {t(key)} <span className="text-[12px]">{t("soon")}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="mt-10 border-t border-line pt-6">
        <p className="font-mono text-[12px] text-muted">{t("copyright")}</p>
      </Container>
    </footer>
  );
}
