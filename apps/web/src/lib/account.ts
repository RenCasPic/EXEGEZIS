import { consumeRateLimit, getProfile, type Profile } from "@exegezis/accounts";
import { getLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { AccountSummary } from "@/components/app-shell/user-menu";
import { config, db, requireUser, type SignedInUser } from "./auth";
import { siteLinks } from "./links";

/*
 * Helpers for the account pages and actions.
 */

/** The signed-in user and their profile; a user who has not accepted the legal texts yet (OAuth sign-up) goes to /welcome first. */
export const requireAccount = cache(async (): Promise<{ user: SignedInUser; profile: Profile }> => {
  const user = await requireUser();
  const profile = await getProfile(db(), user.id);
  if (profile === null || profile.termsVersion === null || profile.privacyVersion === null) {
    const path = (await headers()).get("x-exegezis-path") ?? "/";
    redirect(`/welcome?next=${encodeURIComponent(path)}`);
  }
  return { user, profile };
});

/**
 * The client's address, for the rate limits. Proxies append to
 * X-Forwarded-For, so the entry a client cannot forge is the one added by the
 * nearest trusted proxy: EXEGEZIS_PROXY_HOPS (default 1) counts them from the
 * right (docs/13-accounts.md).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const list = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const hops = Math.max(1, Number(process.env["EXEGEZIS_PROXY_HOPS"] ?? "1") || 1);
  return list[Math.max(0, list.length - hops)] ?? h.get("x-real-ip") ?? "local";
}

/**
 * Defense in depth against CSRF, on top of Next's own Origin check for server
 * actions and SameSite=Lax cookies: the request must come from the app itself.
 */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin === null) return false;
  try {
    const app = new URL(config().appUrl);
    const from = new URL(origin);
    const host = h.get("x-forwarded-host") ?? h.get("host");
    return from.host === app.host || (host !== null && from.host === host);
  } catch {
    return false;
  }
}

export type RateKind = "signin" | "signup" | "recover" | "resend";

const RATE: Record<RateKind, { perIp: number; perEmail: number; windowSeconds: number }> = {
  signin: { perIp: 30, perEmail: 10, windowSeconds: 15 * 60 },
  signup: { perIp: 10, perEmail: 3, windowSeconds: 60 * 60 },
  recover: { perIp: 10, perEmail: 3, windowSeconds: 60 * 60 },
  resend: { perIp: 10, perEmail: 3, windowSeconds: 60 * 60 },
};

/** Counts an attempt (by address and by email); the wait in minutes when it is over the limit. */
export async function rateLimited(kind: RateKind, email: string): Promise<number | null> {
  const r = RATE[kind];
  const ip = await clientIp();
  const byIp = await consumeRateLimit(db(), `${kind}:ip:${ip}`, r.perIp, r.windowSeconds);
  const byEmail = email === "" ? { allowed: true, retryAfterSeconds: 0 } : await consumeRateLimit(db(), `${kind}:email:${email.toLowerCase()}`, r.perEmail, r.windowSeconds);
  if (byIp.allowed && byEmail.allowed) return null;
  return Math.max(1, Math.ceil(Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds) / 60));
}

/** What the user menu shows (the signed-in account; else /login or /welcome). */
export async function accountSummary(): Promise<AccountSummary> {
  const [{ user, profile }, plans, locale] = await Promise.all([requireAccount(), getTranslations("account.plans"), getLocale()]);
  const links = siteLinks(locale === "es" ? "es" : "en");
  return { name: profile.displayName || user.name, email: user.email, plan: plans(profile.plan), plansUrl: links.plans, helpUrl: links.help };
}
