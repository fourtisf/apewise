import { NextResponse } from "next/server";
import {
  pollTrackedWallets,
  debugWalletSwaps,
  activeRpcUrl,
} from "@/lib/server/solanaRpc";
import { addEvents } from "@/lib/server/store";
import { enrichEvent } from "@/lib/server/enrich";
import { sendAlert } from "@/lib/server/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free no-Helius fallback trigger. A PM2 worker (scripts/rpc-poll-worker.mjs)
 * GETs this on an interval; we poll tracked wallets via public Solana RPC, then
 * enrich + store + alert the new swaps — same pipeline as the Helius webhook.
 * Auth = INGEST_SECRET (header `authorization` or `?secret=`).
 */
function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true; // not locked down yet (dev)
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return auth === secret || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Read-only diagnostic: ?debug=<wallet>&limit=N parses that wallet's recent
  // txs without touching the cursor or ingesting — confirms detection on real data.
  const url = new URL(req.url);
  const dbg = url.searchParams.get("debug");
  if (dbg) {
    try {
      const limit = Number(url.searchParams.get("limit")) || 5;
      const rows = await debugWalletSwaps(dbg, limit);
      return NextResponse.json({ ok: true, debug: dbg, rpc: activeRpcUrl(), rows });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: (e as Error).message },
        { status: 500 },
      );
    }
  }

  let parsed;
  try {
    parsed = await pollTrackedWallets();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  await Promise.allSettled(parsed.map((e) => enrichEvent(e)));
  const fresh = await addEvents(parsed);
  await Promise.allSettled(fresh.map((e) => sendAlert(e)));

  return NextResponse.json({ ok: true, found: parsed.length, ingested: fresh.length });
}
