import { useTranslations } from "next-intl";
import { CheckIcon, Container } from "./ui";

const ITEMS = ["verified", "proof", "quotes", "readonly"] as const;

/** The four guarantees, on a white band right under the hero. */
export function Guarantees() {
  const t = useTranslations("guarantees");
  return (
    <section aria-label={t("label")} className="border-b border-line bg-panel">
      <Container>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-4 py-7 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((key) => (
            <li key={key} className="flex items-center gap-3 text-[15px] font-medium text-heading">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                <CheckIcon className="size-4" />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
