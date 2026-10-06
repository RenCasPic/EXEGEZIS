"use server";

import { acceptLegal, isDisposableEmail, isPlanId, passwordProblems, PRIVACY_VERSION, safeNext, TERMS_VERSION } from "@exegezis/accounts";
import { createTranslator } from "next-intl";
import { getLocale } from "next-intl/server";
import { loadMessages } from "@/i18n/messages";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimited, requireAccount, sameOrigin } from "@/lib/account";
import { config, requireUser, supabase } from "@/lib/auth";

/*
 * Sign-in, sign-up, verification, password recovery, OAuth and sign-out.
 * Passwords go straight to Supabase Auth: EXEGEZIS never stores
 * them. Every action checks the request comes from the app and counts
 * attempts per address and per email.
 */

export interface AuthState {
  error: string | null;
  /** Kept in the form after an error (never the password). */
  email?: string;
  name?: string;
}

const Email = z.email().max(320);

/** The account texts in the request's language (a translator over this area only: the whole catalog is too large a type here). */
async function accountTexts() {
  const locale = await getLocale();
  return createTranslator({ locale, messages: { account: loadMessages(locale).account }, namespace: "account" });
}

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

async function errorTexts() {
  const locale = await getLocale();
  return createTranslator({ locale, messages: { account: loadMessages(locale).account }, namespace: "account.errors" });
}

async function guard(): Promise<string | null> {
  const t = await errorTexts();
  if (!(await sameOrigin())) return t("origin");
  return null;
}

/** Supabase refused to send an email for now (its own limit; its test email service sends only a few an hour). */
function emailLimited(error: { code?: string | undefined; status?: number | undefined } | null): boolean {
  return error !== null && (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" || error.status === 429);
}

function callbackUrl(next: string): string {
  return `${config().appUrl}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

export async function signInAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = await errorTexts();
  const email = text(form, "email").trim().toLowerCase();
  const next = safeNext(text(form, "next"));
  const blocked = await guard();
  if (blocked !== null) return { error: blocked, email };
  if (!Email.safeParse(email).success || text(form, "password") === "") return { error: t("credentials"), email };
  const wait = await rateLimited("signin", email);
  if (wait !== null) return { error: t("tooMany", { minutes: wait }), email };
  const { error } = await (await supabase()).auth.signInWithPassword({ email, password: text(form, "password") });
  if (error !== null) {
    if (error.code === "email_not_confirmed") redirect(`/verify-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
    // The same answer for a wrong password and an unknown email: nobody learns which emails have an account.
    return { error: t("credentials"), email };
  }
  redirect(next);
}

export async function signUpAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = await errorTexts();
  const email = text(form, "email").trim().toLowerCase();
  const name = text(form, "name").trim().slice(0, 120);
  const password = text(form, "password");
  const next = safeNext(text(form, "next"));
  const plan = text(form, "plan");
  const blocked = await guard();
  if (blocked !== null) return { error: blocked, email, name };
  if (!Email.safeParse(email).success) return { error: t("email"), email, name };
  if (isDisposableEmail(email)) return { error: t("disposable"), email, name };
  const problems = passwordProblems(password, email);
  if (problems.length > 0) return { error: t(`password.${problems[0] ?? "short"}`), email, name };
  if (text(form, "terms") !== "on") return { error: t("terms"), email, name };
  const wait = await rateLimited("signup", email);
  if (wait !== null) return { error: t("tooMany", { minutes: wait }), email, name };
  const { error } = await (await supabase()).auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: callbackUrl(next),
      data: {
        name,
        locale: await getLocale(),
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        ...(isPlanId(plan) && plan !== "free" ? { plan_interest: plan } : {}),
      },
    },
  });
  if (error !== null) {
    if (error.code === "weak_password") return { error: t("password.leaked"), email, name };
    if (emailLimited(error)) return { error: t("emailLimit"), email, name };
    // An email that already has an account gets the same page: nobody learns which emails are registered.
    if (error.code !== "user_already_exists" && error.code !== "email_exists") return { error: t("unexpected"), email, name };
  }
  redirect(`/verify-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
}

export async function resendVerificationAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = await accountTexts();
  const email = text(form, "email").trim().toLowerCase();
  const blocked = await guard();
  if (blocked !== null) return { error: blocked, email };
  if (!Email.safeParse(email).success) return { error: t("errors.email"), email };
  const wait = await rateLimited("resend", email);
  if (wait !== null) return { error: t("errors.tooMany", { minutes: wait }), email };
  const { error } = await (await supabase()).auth.resend({ type: "signup", email, options: { emailRedirectTo: callbackUrl(text(form, "next")) } });
  // Said, not hidden: otherwise the page says «sent» while nothing was sent.
  if (emailLimited(error)) return { error: t("errors.emailLimit"), email };
  return { error: null, email };
}

export async function forgotPasswordAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = await errorTexts();
  const email = text(form, "email").trim().toLowerCase();
  const blocked = await guard();
  if (blocked !== null) return { error: blocked, email };
  if (!Email.safeParse(email).success) return { error: t("email"), email };
  const wait = await rateLimited("recover", email);
  if (wait !== null) return { error: t("tooMany", { minutes: wait }), email };
  // The same answer whether or not the email has an account.
  const { error } = await (await supabase()).auth.resetPasswordForEmail(email, { redirectTo: callbackUrl("/reset-password") });
  if (emailLimited(error)) return { error: t("emailLimit"), email };
  redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`);
}

export async function resetPasswordAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = await errorTexts();
  const blocked = await guard();
  if (blocked !== null) return { error: blocked };
  const user = await requireUser();
  const password = text(form, "password");
  const problems = passwordProblems(password, user.email);
  if (problems.length > 0) return { error: t(`password.${problems[0] ?? "short"}`) };
  if (password !== text(form, "confirm")) return { error: t("mismatch") };
  const { error } = await (await supabase()).auth.updateUser({ password });
  if (error !== null) return { error: error.code === "weak_password" ? t("password.leaked") : error.code === "same_password" ? t("samePassword") : t("unexpected") };
  redirect("/?notice=password");
}

export async function oauthAction(form: FormData): Promise<void> {
  const provider = text(form, "provider");
  const next = safeNext(text(form, "next"));
  if ((await guard()) !== null) redirect("/login?error=origin");
  if (provider !== "google" && provider !== "github") redirect("/login?error=oauth");
  if (!config().oauthProviders.includes(provider)) redirect("/login?error=oauth");
  const { data, error } = await (await supabase()).auth.signInWithOAuth({ provider, options: { redirectTo: callbackUrl(next) } });
  if (error !== null || data.url === null) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOutAction(): Promise<void> {
  if (await sameOrigin()) await (await supabase()).auth.signOut({ scope: "local" });
  redirect("/login?notice=signedOut");
}

/** Ends every session of the account, on every device (this one too). */
export async function signOutEverywhereAction(): Promise<void> {
  if (await sameOrigin()) {
    await requireUser();
    await (await supabase()).auth.signOut({ scope: "global" });
  }
  redirect("/login?notice=signedOutEverywhere");
}

/** /welcome: a sign-up with Google or GitHub accepts the terms and the privacy policy here. */
export async function acceptTermsAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = await errorTexts();
  const blocked = await guard();
  if (blocked !== null) return { error: blocked };
  if (text(form, "terms") !== "on") return { error: t("terms") };
  // Signed in (else to /login): accept_legal records it for the session's user.
  await requireUser();
  await acceptLegal(await supabase(), TERMS_VERSION, PRIVACY_VERSION);
  redirect(safeNext(text(form, "next")));
}

/** The account is required for the rest of the actions of this file that need it. */
export async function ensureAccount(): Promise<void> {
  await requireAccount();
}
