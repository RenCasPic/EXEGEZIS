import { currentMode } from "@exegezis/accounts";
import { NextResponse } from "next/server";

/** For load balancers and the deployment check: the app answers, and in which mode. */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true, mode: currentMode() }, { headers: { "cache-control": "no-store" } });
}
