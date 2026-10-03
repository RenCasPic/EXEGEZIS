"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { acceptTermsAction, forgotPasswordAction, oauthAction, resendVerificationAction, resetPasswordAction, signInAction, signUpAction, type AuthState } from "@/app/auth-actions";
import { cn } from "@/lib/cn";

/*
 * The account screens: one card with the panel outline of the
 * design system (1.5 px, electric blue in light, lime in dark).
 */

const FIELD = "h-11 w-full rounded-xl border-[1.5px] border-line-strong bg-field px-3.5 text-[15px] text-fg placeholder:text-muted focus:border-accent";
const PRIMARY = "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60";
const SECONDARY = "flex h-11 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-panel px-5 text-[15px] font-medium text-fg hover:bg-hover";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex w-full max-w-[440px] flex-col gap-5">
      <section aria-labelledby="auth-title" className="panel-frame flex flex-col gap-6 rounded-2xl bg-panel px-5 py-7 sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 id="auth-title" className="text-[24px] leading-tight font-semibold tracking-[-0.01em] text-heading">
            {title}
          </h1>
          {subtitle !== undefined && <p className="text-[14px] leading-relaxed text-muted">{subtitle}</p>}
        </div>
        {children}
      </section>
      {footer !== undefined && <div className="text-center text-[14px] text-muted">{footer}</div>}
    </div>
  );
}

function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-[12px] text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function PasswordField({ name, label, autoComplete, hint }: { name: string; label: string; autoComplete: "current-password" | "new-password"; hint?: ReactNode }) {
  const t = useTranslations("account.form");
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} id={id} {...(hint === undefined ? {} : { hint })}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required
          {...(autoComplete === "new-password" ? { minLength: 10 } : {})}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          className={cn(FIELD, "pr-12")}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t("hidePassword") : t("showPassword")}
          aria-pressed={shown}
          className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-fg"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </Field>
  );
}

function EmailField({ defaultValue }: { defaultValue?: string | undefined }) {
  const t = useTranslations("account.form");
  const id = useId();
  return (
    <Field label={t("email")} id={id}>
      <input id={id} name="email" type="email" autoComplete="email" required spellCheck={false} defaultValue={defaultValue} className={FIELD} />
    </Field>
  );
}

function Submit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={PRIMARY}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

function ErrorMessage({ state }: { state: AuthState }) {
  if (state.error === null) return null;
  return (
    <p role="alert" className="rounded-xl border border-bad/30 bg-bad-bg px-3.5 py-2.5 text-[14px] text-bad">
      {state.error}
    </p>
  );
}

const PROVIDER_NAME = { google: "Google", github: "GitHub" } as const;

/** «Continue with Google / GitHub»: only the providers configured (EXEGEZIS_OAUTH_PROVIDERS). */
export function OAuthButtons({ providers, next }: { providers: ("google" | "github")[]; next: string }) {
  const t = useTranslations("account.form");
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {providers.map((p) => (
        <form key={p} action={oauthAction}>
          <input type="hidden" name="provider" value={p} />
          <input type="hidden" name="next" value={next} />
          <button type="submit" className={SECONDARY} data-provider={p}>
            {t("continueWith", { provider: PROVIDER_NAME[p] })}
          </button>
        </form>
      ))}
      <div className="flex items-center gap-3 text-[12px] text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        {t("or")}
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

export function SignInForm({ next, email }: { next: string; email?: string }) {
  const t = useTranslations("account.form");
  const [state, action] = useActionState<AuthState, FormData>(signInAction, { error: null, ...(email === undefined ? {} : { email }) });
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <EmailField defaultValue={state.email} />
      <PasswordField name="password" label={t("password")} autoComplete="current-password" />
      <div className="-mt-1 text-right text-[13px]">
        <Link href="/forgot-password" className="font-medium text-accent-text hover:underline">
          {t("forgot")}
        </Link>
      </div>
      <ErrorMessage state={state} />
      <Submit>{t("signIn")}</Submit>
    </form>
  );
}

export function SignUpForm({ next, plan, termsUrl, privacyUrl }: { next: string; plan: string; termsUrl: string; privacyUrl: string }) {
  const t = useTranslations("account.form");
  const [state, action] = useActionState<AuthState, FormData>(signUpAction, { error: null });
  const nameId = useId();
  const termsId = useId();
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="plan" value={plan} />
      <Field label={t("name")} id={nameId}>
        <input id={nameId} name="name" type="text" autoComplete="name" maxLength={120} defaultValue={state.name} className={FIELD} />
      </Field>
      <EmailField defaultValue={state.email} />
      <PasswordField name="password" label={t("password")} autoComplete="new-password" hint={t("passwordRules")} />
      <label htmlFor={termsId} className="flex items-start gap-2.5 text-[14px] leading-snug text-fg">
        <input id={termsId} name="terms" type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
        <span>
          {t.rich("acceptTerms", {
            terms: (chunks) => (
              <a href={termsUrl} target="_blank" rel="noopener" className="font-medium text-accent-text underline">
                {chunks}
              </a>
            ),
            privacy: (chunks) => (
              <a href={privacyUrl} target="_blank" rel="noopener" className="font-medium text-accent-text underline">
                {chunks}
              </a>
            ),
          })}
        </span>
      </label>
      <ErrorMessage state={state} />
      <Submit>{t("createAccount")}</Submit>
    </form>
  );
}

export function ResendForm({ email, next }: { email: string; next: string }) {
  const t = useTranslations("account");
  const [state, action] = useActionState<AuthState, FormData>(resendVerificationAction, { error: null, email });
  const [sent, setSent] = useState(false);
  return (
    <form
      action={(data) => {
        setSent(true);
        action(data);
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <ErrorMessage state={state} />
      {sent && state.error === null && (
        <p role="status" className="text-[14px] text-ok">
          {t("verify.resent")}
        </p>
      )}
      <button type="submit" className={SECONDARY}>
        {t("verify.resend")}
      </button>
    </form>
  );
}

export function ForgotForm({ email }: { email?: string }) {
  const t = useTranslations("account.form");
  const [state, action] = useActionState<AuthState, FormData>(forgotPasswordAction, { error: null, ...(email === undefined ? {} : { email }) });
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <EmailField defaultValue={state.email} />
      <ErrorMessage state={state} />
      <Submit>{t("sendLink")}</Submit>
    </form>
  );
}

export function ResetForm() {
  const t = useTranslations("account.form");
  const [state, action] = useActionState<AuthState, FormData>(resetPasswordAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <PasswordField name="password" label={t("newPassword")} autoComplete="new-password" hint={t("passwordRules")} />
      <PasswordField name="confirm" label={t("confirmPassword")} autoComplete="new-password" />
      <ErrorMessage state={state} />
      <Submit>{t("savePassword")}</Submit>
    </form>
  );
}

export function WelcomeForm({ next, termsUrl, privacyUrl }: { next: string; termsUrl: string; privacyUrl: string }) {
  const t = useTranslations("account.form");
  const [state, action] = useActionState<AuthState, FormData>(acceptTermsAction, { error: null });
  const termsId = useId();
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor={termsId} className="flex items-start gap-2.5 text-[14px] leading-snug text-fg">
        <input id={termsId} name="terms" type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
        <span>
          {t.rich("acceptTerms", {
            terms: (chunks) => (
              <a href={termsUrl} target="_blank" rel="noopener" className="font-medium text-accent-text underline">
                {chunks}
              </a>
            ),
            privacy: (chunks) => (
              <a href={privacyUrl} target="_blank" rel="noopener" className="font-medium text-accent-text underline">
                {chunks}
              </a>
            ),
          })}
        </span>
      </label>
      <ErrorMessage state={state} />
      <Submit>{t("continue")}</Submit>
    </form>
  );
}
