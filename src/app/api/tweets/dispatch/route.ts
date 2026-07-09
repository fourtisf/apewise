import { NextResponse } from "next/server";
import { dispatchTweets } from "@/lib/server/tweets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Post at most one strictly-gated smart-money tweet. Hit on an interval by the
 * tweet worker / a cron. Auth via INGEST_SECRET (?secret= or Authorization),
 * mirroring /api/alerts/dispatch.
 */
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
  const result = await dispatchTweets();
  return NextResponse.json({ ok: true, ...result });
}
