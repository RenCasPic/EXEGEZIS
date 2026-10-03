import { NextResponse } from "next/server";

/** For load balancers and the deployment check: the app answers. */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
