import { safeNext } from "@exegezis/accounts";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { afterSignIn } from "@/lib/after-sign-in";
import { config, supabase } from "@/lib/auth";

const TYPES: EmailOtpType[] = ["signup", "recovery", "email", "email_change", "invite", "magiclink"];

/**
 * The email links of the templates in docs/13-accounts.md
 * ({{ .SiteURL }}/auth/confirm?token_hash=…&type=…&next=…): checked here, on
 * the server, without the PKCE cookie, so they also work in another browser.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const app = config().appUrl;
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = TYPES.find((t) => t === request.nextUrl.searchParams.get("type"));
  const next = safeNext(request.nextUrl.searchParams.get("next"), type === "recovery" ? "/reset-password" : "/");
  if (tokenHash !== null && type !== undefined) {
    const { error } = await (await supabase()).auth.verifyOtp({ type, token_hash: tokenHash });
    if (error === null) {
      await afterSignIn();
      return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : next, app));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", app));
}
