"use server";

import { rm } from "node:fs/promises";
import { deleteUser, joinWaitlist, passwordProblems, updateProfile, userDirs } from "@exegezis/accounts";
import { createTranslator } from "next-intl";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";
import { rateLimited, requireAccount, sameOrigin } from "@/lib/account";
import { cloud, db, isCloud, supabase } from "@/lib/cloud";
import { dataDir } from "@/lib/user-workspace";

/*
 * Settings → Account (cloud mode): profile, security, plan and data. Every
 * action checks the request comes from the app and acts only on the signed-in
 * user's own account.
 */

export interface AccountState {
  error: string | null;
  done?: string;
}

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

async function texts() {
  const locale = await getLocale();
  return createTranslator({ locale, messages: { account: loadMessages(locale).account }, namespace: "account" });
}

async function guard(): Promise<string | null> {
  const t = await texts();
  if (!isCloud()) return t("errors.localMode");
  if (!(await sameOrigin())) return t("errors.origin");
  return null;
}

const Profile = z.object({
  displayName: z.string().trim().max(120),
  locale: z.enum(["en", "es"]),
  theme: z.enum(["light", "dark", "system"]),
});

export async function updateProfileAction(_prev: AccountState, form: FormData): Promise<AccountState> {
  const blocked = await guard();
  if (blocked !== null) return { error: blocked };
  const t = await texts();
  const parsed = Profile.safeParse({ displayName: text(form, "displayName"), locale: text(form, "locale"), theme: text(form, "theme") });
  if (!parsed.success) return { error: t("errors.unexpected") };
  const { user } = await requireAccount();
  await updateProfile(db(), user.id, parsed.data);
  (await cookies()).set(LOCALE_COOKIE, parsed.data.locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return { error: null, done: t("settings.saved") };
}

export async function changeEmailAction(_prev: AccountState, form: FormData): Promise<AccountState> {
  const blocked = await guard();
  if (blocked !== null) return { error: blocked };
  const t = await texts();
  const email = text(form, "email").trim().toLowerCase();
  if (!z.email().max(320).safeParse(email).success) return { error: t("errors.email") };
  await requireAccount();
  const { error } = await (await supabase()).auth.updateUser({ email }, { emailRedirectTo: `${cloud().appUrl}/auth/callback?next=/settings/account` });
  if (error !== null) return { error: t("errors.unexpected") };
  return { error: null, done: t("settings.emailSent", { email }) };
}

export async function changePasswordAction(_prev: AccountState, form: FormData): Promise<AccountState> {
  const blocked = await guard();
  if (blocked !== null) return { error: blocked };
  const t = await texts();
  const { user } = await requireAccount();
  const password = text(form, "password");
  const problems = passwordProblems(password, user.email);
  if (problems.length > 0) return { error: t(`errors.password.${problems[0] ?? "short"}`) };
  if (password !== text(form, "confirm")) return { error: t("errors.mismatch") };
  const wait = await rateLimited("signin", user.email);
  if (wait !== null) return { error: t("errors.tooMany", { minutes: wait }) };
  const sb = await supabase();
  // Accounts created with a password confirm the current one first.
  if (user.providers.includes("email")) {
    const check = await sb.auth.signInWithPassword({ email: user.email, password: text(form, "current") });
    if (check.error !== null) return { error: t("errors.wrongPassword") };
  }
  const { error } = await sb.auth.updateUser({ password });
  if (error !== null) return { error: error.code === "weak_password" ? t("errors.password.leaked") : error.code === "same_password" ? t("errors.samePassword") : t("errors.unexpected") };
  return { error: null, done: t("settings.passwordChanged") };
}

/** Links Google or GitHub to this account (Supabase «manual linking» must be on). */
export async function linkIdentityAction(form: FormData): Promise<void> {
  if ((await guard()) !== null) redirect("/settings/account?error=origin#security");
  const provider = text(form, "provider");
  if ((provider !== "google" && provider !== "github") || !cloud().oauthProviders.includes(provider)) redirect("/settings/account#security");
  await requireAccount();
  const { data, error } = await (await supabase()).auth.linkIdentity({ provider, options: { redirectTo: `${cloud().appUrl}/auth/callback?next=/settings/account` } });
  if (error !== null || data.url === null) redirect("/settings/account?error=link#security");
  redirect(data.url);
}

export async function unlinkIdentityAction(form: FormData): Promise<void> {
  if ((await guard()) !== null) redirect("/settings/account?error=origin#security");
  const { user } = await requireAccount();
  const identities = user.user.identities ?? [];
  const identity = identities.find((i) => i.provider === text(form, "provider"));
  // The last way to sign in is never removed.
  if (identity !== undefined && identities.length > 1) await (await supabase()).auth.unlinkIdentity(identity);
  redirect("/settings/account#security");
}

export async function joinWaitlistAction(form: FormData): Promise<void> {
  if ((await guard()) !== null) redirect("/settings/account#plan");
  const plan = text(form, "plan");
  if (plan !== "pro" && plan !== "team" && plan !== "enterprise") redirect("/settings/account#plan");
  const { user } = await requireAccount();
  await joinWaitlist(db(), user.id, user.email, plan);
  redirect("/settings/account?notice=waitlist#plan");
}

/**
 * Deletes the account after the person types its email: its artifacts folder,
 * every row in the database (by cascade) and the Supabase Auth user. Then the
 * session ends. It cannot be undone.
 */
export async function deleteAccountAction(_prev: AccountState, form: FormData): Promise<AccountState> {
  const blocked = await guard();
  if (blocked !== null) return { error: blocked };
  const t = await texts();
  const { user } = await requireAccount();
  if (text(form, "confirm").trim().toLowerCase() !== user.email.toLowerCase()) return { error: t("settings.delete.mismatch") };
  await rm(userDirs(dataDir(), user.id).root, { recursive: true, force: true });
  await (await supabase()).auth.signOut({ scope: "global" });
  await deleteUser(db(), user.id);
  redirect("/login?notice=deleted");
}
