import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/shell";

/**
 * The sidebar and the top bar. Below the root layout on purpose: a page's
 * notFound() is then caught by (shell)/not-found.tsx inside the app's own
 * document (its language, theme and shell).
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
