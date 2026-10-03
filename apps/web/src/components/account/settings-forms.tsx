"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useId, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { changeEmailAction, changePasswordAction, deleteAccountAction, updateProfileAction, type AccountState } from "@/app/account-actions";
import { LOCALE_NAME, LOCALES } from "@/i18n/locales";
import { applyTheme, writeThemePreference, type ThemePreference } from "@/lib/theme";

const FIELD = "h-10 w-full rounded-lg border-[1.5px] border-line-strong bg-field px-3 text-[14px] text-fg focus:border-accent";

function Row({ label, children, id }: { label: ReactNode; children: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
    </div>
  );
}

function Submit({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`flex h-10 items-center justify-center gap-2 self-start rounded-lg px-4 text-[14px] font-semibold disabled:opacity-60 ${danger ? "bg-bad text-bg hover:opacity-90" : "bg-accent text-on-accent hover:bg-accent-hover"}`}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

function Result({ state }: { state: AccountState }) {
  if (state.error !== null)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-[13px] text-bad">
        {state.error}
      </p>
    );
  if (state.done !== undefined)
    return (
      <p role="status" className="rounded-lg border border-ok/30 bg-ok-bg px-3 py-2 text-[13px] text-ok">
        {state.done}
      </p>
    );
  return null;
}

export function ProfileForm({ displayName, locale, theme }: { displayName: string; locale: "en" | "es"; theme: ThemePreference }) {
  const t = useTranslations("account.settings");
  const [state, action] = useActionState<AccountState, FormData>(updateProfileAction, { error: null });
  const ids = { name: useId(), locale: useId(), theme: useId() };
  return (
    <form
      action={(data) => {
        const chosen = data.get("theme");
        if (chosen === "light" || chosen === "dark" || chosen === "system") {
          writeThemePreference(chosen);
          applyTheme(chosen);
        }
        action(data);
      }}
      className="flex flex-col gap-4"
    >
      <Row label={t("name")} id={ids.name}>
        <input id={ids.name} name="displayName" defaultValue={displayName} maxLength={120} autoComplete="name" className={FIELD} />
      </Row>
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label={t("language")} id={ids.locale}>
          <select id={ids.locale} name="locale" defaultValue={locale} className={FIELD}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAME[l]}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("theme")} id={ids.theme}>
          <select id={ids.theme} name="theme" defaultValue={theme} className={FIELD}>
            <option value="light">{t("themeLight")}</option>
            <option value="dark">{t("themeDark")}</option>
            <option value="system">{t("themeSystem")}</option>
          </select>
        </Row>
      </div>
      <Result state={state} />
      <Submit>{t("save")}</Submit>
    </form>
  );
}

export function EmailForm({ email }: { email: string }) {
  const t = useTranslations("account.settings");
  const [state, action] = useActionState<AccountState, FormData>(changeEmailAction, { error: null });
  const id = useId();
  return (
    <form action={action} className="flex flex-col gap-4">
      <Row label={t("email")} id={id}>
        <input id={id} name="email" type="email" defaultValue={email} autoComplete="email" required className={FIELD} />
      </Row>
      <p className="text-[12px] text-muted">{t("emailHint")}</p>
      <Result state={state} />
      <Submit>{t("changeEmail")}</Submit>
    </form>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("account");
  const [state, action] = useActionState<AccountState, FormData>(changePasswordAction, { error: null });
  const ids = { current: useId(), next: useId(), confirm: useId() };
  return (
    <form action={action} className="flex flex-col gap-4">
      {hasPassword && (
        <Row label={t("form.currentPassword")} id={ids.current}>
          <input id={ids.current} name="current" type="password" autoComplete="current-password" required className={FIELD} />
        </Row>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label={t("form.newPassword")} id={ids.next}>
          <input id={ids.next} name="password" type="password" autoComplete="new-password" minLength={10} required className={FIELD} />
        </Row>
        <Row label={t("form.confirmPassword")} id={ids.confirm}>
          <input id={ids.confirm} name="confirm" type="password" autoComplete="new-password" minLength={10} required className={FIELD} />
        </Row>
      </div>
      <p className="text-[12px] text-muted">{t("form.passwordRules")}</p>
      <Result state={state} />
      <Submit>{hasPassword ? t("settings.changePassword") : t("settings.setPassword")}</Submit>
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const t = useTranslations("account.settings.delete");
  const [state, action] = useActionState<AccountState, FormData>(deleteAccountAction, { error: null });
  const id = useId();
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-[13px] text-fg">{t("warning")}</p>
      <Row label={t.rich("confirmLabel", { email: () => <strong className="font-mono">{email}</strong> })} id={id}>
        <input id={id} name="confirm" type="text" autoComplete="off" spellCheck={false} required className={FIELD} data-delete-confirm />
      </Row>
      <Result state={state} />
      <Submit danger>{t("button")}</Submit>
    </form>
  );
}
