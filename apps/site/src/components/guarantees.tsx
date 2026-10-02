import { Camera, CheckCheck, Quote, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Container } from "./ui";

const ITEMS = [
  ["verified", CheckCheck],
  ["proof", Camera],
  ["quotes", Quote],
  ["readonly", ShieldCheck],
] as const;

/** The four guarantees, right under the hero. */
export function Guarantees() {
  const t = useTranslations("guarantees");
  return (
    <section aria-label={t("label")} className="border-b border-line bg-panel">
      <Container>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-4 py-6 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map(([key, Icon]) => (
            <li key={key} className="flex items-center gap-3 text-[14px] font-medium text-heading">
              <Icon className="size-5 shrink-0 text-accent-text" aria-hidden />
              {t(key)}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
