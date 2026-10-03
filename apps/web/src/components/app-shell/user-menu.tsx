"use client";

import { CircleHelp, CreditCard, LogOut, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/app/auth-actions";

export interface AccountSummary {
  name: string;
  email: string;
  plan: string;
  plansUrl: string;
  helpUrl: string;
}

function initials(name: string, email: string): string {
  const words = (name || email).split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * The signed-in user (cloud mode), in the same place and size as the local
 * user's initials: My account · See plans · Help · Sign out.
 */
export function UserMenu({ account }: { account: AccountSummary }) {
  const t = useTranslations("account.menu");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-fg hover:bg-hover";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("open", { name: account.name || account.email })}
        data-user-menu
        className="grid size-8 place-items-center rounded-full border border-line-strong bg-panel-2 font-mono text-[11px] text-muted uppercase hover:text-fg"
      >
        {initials(account.name, account.email)}
      </button>
      {open && (
        <div id={menuId} className="panel-frame absolute right-0 z-40 mt-2 w-64 rounded-lg bg-panel p-1.5">
          <div className="border-b border-line px-2.5 pt-1.5 pb-2.5">
            <div className="truncate text-[13px] font-medium text-fg">{account.name || account.email}</div>
            <div className="truncate text-[12px] text-muted">{account.email}</div>
            <div className="mt-1 text-[11px] text-muted">{t("plan", { plan: account.plan })}</div>
          </div>
          <div className="flex flex-col pt-1.5">
            <Link href="/settings/account" onClick={() => setOpen(false)} className={item}>
              <UserRound className="size-4 text-muted" aria-hidden />
              {t("account")}
            </Link>
            <a href={account.plansUrl} className={item}>
              <CreditCard className="size-4 text-muted" aria-hidden />
              {t("plans")}
            </a>
            <a href={account.helpUrl} className={item}>
              <CircleHelp className="size-4 text-muted" aria-hidden />
              {t("help")}
            </a>
            <form action={signOutAction} className="mt-1 border-t border-line pt-1">
              <button type="submit" className={item} data-sign-out>
                <LogOut className="size-4 text-muted" aria-hidden />
                {t("signOut")}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
