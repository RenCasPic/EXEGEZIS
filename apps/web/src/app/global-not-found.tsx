import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "404 · EXEGEZIS" };

/** A URL that matches no page (the app and the public pages have separate root layouts). */
export default function GlobalNotFound() {
  return (
    <html lang="en" data-theme="light" className={GeistSans.variable}>
      <body className="grid min-h-screen place-items-center bg-bg font-sans text-fg">
        <main className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-mono text-[13px] tracking-[0.14em] text-accent-text">404</p>
          <h1 className="text-[28px] font-semibold text-heading">Not found · No encontrado</h1>
          <a href="/" className="text-[15px] font-medium text-accent-text hover:underline">
            EXEGEZIS
          </a>
        </main>
      </body>
    </html>
  );
}
