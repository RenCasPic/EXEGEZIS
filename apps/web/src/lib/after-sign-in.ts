import { getProfile, isPlanId, joinWaitlist } from "@exegezis/accounts";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { db, getUser } from "./cloud";

/**
 * Right after an email link or an OAuth sign-in has created the session:
 * - a sign-up that came from a paid plan («Try Pro») joins its waiting list;
 * - the interface follows the language saved in the profile.
 */
export async function afterSignIn(): Promise<void> {
  const user = await getUser();
  if (user === null) return;
  const interest = (user.user.user_metadata as Record<string, unknown>)["plan_interest"];
  if (isPlanId(interest) && interest !== "free") await joinWaitlist(db(), user.id, user.email, interest);
  const profile = await getProfile(db(), user.id);
  if (profile !== null) (await cookies()).set(LOCALE_COOKIE, profile.locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}
