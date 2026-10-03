import { getProfile } from "@exegezis/accounts";
import { NextResponse, type NextRequest } from "next/server";
import { cloud, db, getUser, isCloud } from "@/lib/cloud";
import { siteUrl } from "@/lib/links";

/**
 * For the landing's header: is the visitor signed in? (name and initials
 * only). Readable from the landing's origin alone (CORS with credentials);
 * the session cookie stays httpOnly and never leaves the app. In local mode
 * there are no accounts: always signed out.
 */
function cors(request: NextRequest, response: NextResponse): NextResponse {
  const allowed = new URL(siteUrl()).origin;
  if (request.headers.get("origin") === allowed) {
    response.headers.set("access-control-allow-origin", allowed);
    response.headers.set("access-control-allow-credentials", "true");
  }
  response.headers.set("vary", "Origin");
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCloud()) return cors(request, NextResponse.json({ mode: "local", signedIn: false }));
  const user = await getUser();
  if (user === null) return cors(request, NextResponse.json({ mode: "cloud", signedIn: false, appUrl: cloud().appUrl }));
  const profile = await getProfile(db(), user.id);
  const name = profile?.displayName || user.name;
  return cors(request, NextResponse.json({ mode: "cloud", signedIn: true, name, appUrl: cloud().appUrl }));
}

export function OPTIONS(request: NextRequest): NextResponse {
  const response = cors(request, new NextResponse(null, { status: 204 }));
  response.headers.set("access-control-allow-methods", "GET");
  return response;
}
