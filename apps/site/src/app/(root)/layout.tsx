import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../globals.css";

export const metadata: Metadata = {
  title: "EXEGEZIS",
  description: "EXEGEZIS — Only what can be proven. / Solo lo que se puede demostrar.",
  alternates: { languages: { en: "/en/", es: "/es/" } },
};

/** `/` only sends the visitor to their language; it has its own root layout (the language pages use [locale]). */
export default function RootRedirectLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
