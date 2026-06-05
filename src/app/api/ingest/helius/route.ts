import { NextResponse } from "next/server";
import { walletMap } from "@/lib/server/wallets";
import { parseHeliusTx, involvedAccounts, type HeliusTx } from "@/lib/server/helius";
import { addEvents, type SmartEvent } from "@/lib/server/store";
import { enrichEvent } from "@/lib/server/enrich";
import { getSolPriceUsd } from "@/lib/server/market";
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
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let txs: HeliusTx[];
  try {
    const body = await req.json();
    txs = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const [wallets, solPrice] = await Promise.all([walletMap(), getSolPriceUsd()]);
  const parsed: SmartEvent[] = [];
  let matched = 0; // txs whose swap involved a tracked wallet

  for (const tx of txs) {
    for (const addr of involvedAccounts(tx)) {
      const wallet = wallets.get(addr);
      if (!wallet) continue;
      matched++;
      const ev = parseHeliusTx(tx, wallet, solPrice);
      if (ev) parsed.push(ev);
      break; // one event per tx
    }
  }

  // Enrich (symbol / market / anti-rug), then store (dedup) and alert only new.
  await Promise.allSettled(parsed.map((e) => enrichEvent(e)));
  const fresh = await addEvents(parsed);
  await Promise.allSettled(fresh.map((e) => sendAlert(e)));

  // Ops visibility: one line per delivery so a silent parsed:0 is diagnosable
  // (matched=0 → wallet not in the tracked set; matched>0 & parsed=0 → the swap
  // shape didn't parse). INGEST_DEBUG=true also dumps the first non-parsing tx so
  // the real (aggregator) swap structure can be inspected.
  console.log(
    `[helius] txs=${txs.length} matched=${matched} parsed=${parsed.length} ingested=${fresh.length}`,
  );
  if (process.env.INGEST_DEBUG === "true" && parsed.length < txs.length && txs[0]) {
    console.log("[helius] sample tx:", JSON.stringify(txs[0]).slice(0, 2000));
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
