import { exportAccount, userDirs, zipAccount } from "@exegezis/accounts";
import { NextResponse, type NextRequest } from "next/server";
import { db, getUser, isCloud } from "@/lib/cloud";
import { dataDir } from "@/lib/user-workspace";

/**
 * «Export my data» (cloud mode): a ZIP with account.json (profile, legal
 * acceptances, projects, runs, waiting list) and every file of the user's
 * folders (runs, saved accesses — still encrypted —, search settings).
 * Only the signed-in user's own data; a page from another site cannot ask
 * for it (Sec-Fetch-Site).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCloud()) return new NextResponse(null, { status: 404 });
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return new NextResponse(null, { status: 403 });
  const user = await getUser();
  if (user === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dirs = userDirs(dataDir(), user.id);
  const json = { exportedAt: new Date().toISOString(), user: { id: user.id, email: user.email, providers: user.providers }, ...(await exportAccount(db(), user.id)) };
  const zip = await zipAccount(json, [
    { name: "runs", path: dirs.runs },
    { name: "access", path: dirs.access },
    { name: "search", path: dirs.search },
  ]);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="exegezis-${new Date().toISOString().slice(0, 10)}.zip"`,
      "cache-control": "no-store",
    },
  });
}
