"use server";

import { addSite, listSites, markSiteVerified, removeSite, siteOf } from "@exegezis/accounts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount, sameOrigin } from "@/lib/account";
import { adminDb, supabase } from "@/lib/auth";
import { checkOwnership } from "@/lib/site-ownership";

/*
 * Settings → Sites: the sites a user proves are theirs (inspections and
 * searches of more than 20 pages). Every action checks the request comes from
 * the app and acts on the signed-in user's own sites only.
 */

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** An address or a bare domain («tu-sitio.com») as the site it is about. */
function siteFrom(raw: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  return siteOf(withScheme);
}

export async function addSiteAction(form: FormData): Promise<void> {
  if (!(await sameOrigin())) redirect("/settings/sites?error=origin");
  const site = siteFrom(text(form, "site"));
  if (site === "" || !site.includes(".")) redirect("/settings/sites?error=site");
  const { user } = await requireAccount();
  await addSite(await supabase(), user.id, site);
  revalidatePath("/settings/sites");
  redirect(`/settings/sites?site=${encodeURIComponent(site)}#${encodeURIComponent(site)}`);
}

export async function verifySiteAction(form: FormData): Promise<void> {
  if (!(await sameOrigin())) redirect("/settings/sites?error=origin");
  const site = text(form, "site");
  const { user } = await requireAccount();
  const entry = (await listSites(await supabase())).find((s) => s.site === site);
  if (entry === undefined) redirect("/settings/sites");
  const method = await checkOwnership(entry.site, entry.token);
  if (method === null) redirect(`/settings/sites?site=${encodeURIComponent(site)}&check=failed#${encodeURIComponent(site)}`);
  await markSiteVerified(adminDb(), user.id, entry.site, method);
  revalidatePath("/settings/sites");
  redirect(`/settings/sites?site=${encodeURIComponent(site)}&check=ok#${encodeURIComponent(site)}`);
}

export async function removeSiteAction(form: FormData): Promise<void> {
  if (!(await sameOrigin())) redirect("/settings/sites?error=origin");
  await requireAccount();
  await removeSite(await supabase(), text(form, "site"));
  revalidatePath("/settings/sites");
  redirect("/settings/sites");
}
