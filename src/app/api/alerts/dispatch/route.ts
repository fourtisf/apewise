import { NextResponse } from "next/server";
import { dispatchAlerts } from "@/lib/server/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Post new notable alerts to the signals channel. Hit on an interval by the
 *  alert worker / a cron. Auth via INGEST_SECRET (?secret= or Authorization). */
function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return auth === secret || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const posted = await dispatchAlerts();
  return NextResponse.json({ ok: true, posted });
}
