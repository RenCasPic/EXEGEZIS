import { safeNext } from "@exegezis/accounts";
import { NextResponse, type NextRequest } from "next/server";
import { afterSignIn } from "@/lib/after-sign-in";
import { cloud, isCloud, supabase } from "@/lib/cloud";

/**
 * Where Supabase Auth sends the person back with a one-time `code` (PKCE):
 * the email verification link, the password recovery link and every OAuth
 * sign-in. The code becomes the session cookies, then to `next` (a path of
 * this app only). Redirects use the configured app URL, never the Host header.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCloud()) return new NextResponse(null, { status: 404 });
  const app = cloud().appUrl;
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  if (code !== null && code !== "") {
    const { error } = await (await supabase()).auth.exchangeCodeForSession(code);
    if (error === null) {
      await afterSignIn();
      return NextResponse.redirect(new URL(next, app));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", app));
}
