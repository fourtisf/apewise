import { NextResponse } from "next/server";
import {
  getHealth,
  deriveVerdict,
  DEFAULT_THRESHOLDS,
} from "@/lib/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pipeline health for operators + the watchdog worker. Reports the last
 * success/failure of every stage (ingest, Telegram, X, tweet dispatch) and a
 * derived verdict: ok | degraded | stalled. Auth via INGEST_SECRET, mirroring
 * the other operational endpoints.
 */
function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return auth === secret || url.searchParams.get("secret") === secret;
}

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const snapshot = getHealth();
  const verdict = deriveVerdict(snapshot, Date.now(), {
    ingestStallMin: num("HEALTH_INGEST_STALL_MIN", DEFAULT_THRESHOLDS.ingestStallMin),
    eventStallMin: num("HEALTH_EVENT_STALL_MIN", DEFAULT_THRESHOLDS.eventStallMin),
    channelFailStreak: num("HEALTH_CHANNEL_FAIL_STREAK", DEFAULT_THRESHOLDS.channelFailStreak),
    rpcFailStreak: num("HEALTH_RPC_FAIL_STREAK", DEFAULT_THRESHOLDS.rpcFailStreak),
  });
  return NextResponse.json({
    ok: true,
    ...verdict,
    channels: {
      telegramConfigured: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_SIGNALS_CHAT_ID,
      ),
      twitterConfigured: Boolean(
        process.env.TWITTER_API_KEY &&
          process.env.TWITTER_API_SECRET &&
          process.env.TWITTER_ACCESS_TOKEN &&
          process.env.TWITTER_ACCESS_SECRET,
      ),
    },
    health: snapshot,
  });
}
