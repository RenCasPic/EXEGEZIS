import type { PlanId } from "./pricing.js";

/*
 * Protection against abuse, on top of each plan's monthly limits
 * (pricing.ts). The server checks all of it before any job starts
 * (apps/web lib/plan-gate.ts), so no form or route can skip it.
 */

export type RunKindLimited = "inspection" | "search" | "investigation";

/** Jobs a user may start per hour (null: no hourly limit). A burst of jobs in a row is refused for a while. */
export const HOURLY_PER_USER: Record<PlanId, Record<RunKindLimited, number | null>> = {
  free: { inspection: 5, search: 10, investigation: 5 },
  pro: { inspection: 30, search: 60, investigation: 30 },
  team: { inspection: 60, search: 120, investigation: 60 },
  enterprise: { inspection: null, search: null, investigation: null },
};

/** Jobs per hour from one address, whatever the accounts (several accounts from one place). */
export const HOURLY_PER_IP: Record<RunKindLimited, number> = { inspection: 60, search: 120, investigation: 60 };

/** Above this many pages, an inspection or a search needs the site to be verified as the user's. */
export const OWNERSHIP_PAGES = 20;

/**
 * Daily caps of AI spending (USD), per user and for everyone together; the
 * operator sets them in .env (EXEGEZIS_AI_DAILY_USER_USD,
 * EXEGEZIS_AI_DAILY_TOTAL_USD). Reaching one stops AI work until the next
 * day (UTC) and says so.
 */
export function aiDailyCaps(env: NodeJS.ProcessEnv = process.env): { user: number; total: number } {
  const num = (name: string, fallback: number) => {
    const v = Number((env[name] ?? "").trim());
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return { user: num("EXEGEZIS_AI_DAILY_USER_USD", 2), total: num("EXEGEZIS_AI_DAILY_TOTAL_USD", 25) };
}

/** What one investigation costs in AI, roughly (one planner call), for the daily caps. */
export const INVESTIGATION_AI_USD = 0.05;

/** The first instant of today, in UTC. */
export function dayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Throwaway email providers (addresses that last minutes): refused at
 * sign-up. A short list of the common ones, not a guarantee; subdomains count.
 */
const DISPOSABLE = new Set([
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com", "anonbox.net", "burnermail.io", "byom.de", "dispostable.com",
  "dropmail.me", "emailondeck.com", "fakeinbox.com", "fakemail.net", "getairmail.com", "getnada.com", "guerrillamail.biz", "guerrillamail.com",
  "guerrillamail.de", "guerrillamail.info", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "harakirimail.com", "inboxbear.com",
  "incognitomail.org", "jetable.org", "mail-temp.com", "mail.tm", "mailcatch.com", "maildrop.cc", "mailinator.com", "mailinator.net",
  "mailnesia.com", "mailpoof.com", "mintemail.com", "moakt.com", "mohmal.com", "mytemp.email", "nada.email", "sharklasers.com", "spam4.me",
  "spambox.us", "spamgourmet.com", "tempail.com", "temp-mail.io", "temp-mail.org", "tempmail.com", "tempmail.dev", "tempmail.net",
  "tempmailo.com", "tempr.email", "throwawaymail.com", "trashmail.com", "trashmail.de", "trashmail.net", "yopmail.com", "yopmail.fr",
  "yopmail.net", "emailfake.com", "fakemailgenerator.com", "minuteinbox.com", "tmail.ws", "tmpmail.org", "tmpmail.net", "1secmail.com",
  "1secmail.net", "1secmail.org", "linshiyouxiang.net", "grr.la", "pokemail.net", "mvrht.com", "discard.email", "mailbox.in.ua",
]);

/** Is this address at a throwaway email provider? */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (domain === "") return false;
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) if (DISPOSABLE.has(labels.slice(i).join("."))) return true;
  return false;
}
