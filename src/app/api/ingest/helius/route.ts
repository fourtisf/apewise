import { NextResponse } from "next/server";
import { walletMap } from "@/lib/server/wallets";
import {
  parseHeliusTx,
  involvedAccounts,
  type HeliusTx,
} from "@/lib/server/helius";
import { addEvents, type SmartEvent } from "@/lib/server/store";
import { enrichEvent } from "@/lib/server/enrich";
import { sendAlert } from "@/lib/server/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Helius enhanced-webhook receiver. Register a webhook (type "enhanced",
 * transactionTypes ["SWAP"]) for the tracked wallet addresses pointing here, with
 * authHeader = INGEST_SECRET. See scripts/setup-helius-webhook.mjs.
 */
function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true; // not locked down yet (dev)
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return auth === secret || url.searchParams.get("secret") === secret;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    console.warn(
      "[helius] 401 unauthorized — the registered authHeader != INGEST_SECRET",
    );
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let txs: HeliusTx[];
  try {
    const body = await req.json();
    txs = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const wallets = await walletMap();
  const parsed: SmartEvent[] = [];

  for (const tx of txs) {
    for (const addr of involvedAccounts(tx)) {
      const wallet = wallets.get(addr);
      if (!wallet) continue;
      const ev = await parseHeliusTx(tx, wallet);
      if (ev) {
        parsed.push(ev);
        break; // one event per tx
      }
    }
  }

  // Enrich (symbol / market / anti-rug), then store (dedup) and alert only new.
  await Promise.allSettled(parsed.map((e) => enrichEvent(e)));
  const fresh = await addEvents(parsed);
  await Promise.allSettled(fresh.map((e) => sendAlert(e)));

  // Observability: shows whether Helius is delivering + whether swaps parse.
  console.log(
    `[helius] rx=${txs.length} parsed=${parsed.length} ingested=${fresh.length}`,
  );
  if (parsed.length === 0 && txs.length > 0) {
    const accts = involvedAccounts(txs[0]);
    const matched = [...accts].filter((a) => wallets.has(a)).length;
    console.log(
      `[helius] no-parse sample: type=${txs[0].type} accts=${accts.size}` +
        ` matched=${matched} tokenTransfers=${(txs[0].tokenTransfers || []).length}`,
    );
  }
  return NextResponse.json({
    ok: true,
    parsed: parsed.length,
    ingested: fresh.length,
  });
}

export function GET() {
  return NextResponse.json({ ok: true, message: "POST Helius enhanced webhooks here." });
}
