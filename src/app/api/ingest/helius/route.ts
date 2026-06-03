import { NextResponse } from "next/server";
import { walletMap } from "@/lib/server/wallets";
import { parseHeliusTx, type HeliusTx } from "@/lib/server/helius";
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
    const involved = new Set<string>();
    const sw = tx.events?.swap;
    for (const leg of [...(sw?.tokenInputs || []), ...(sw?.tokenOutputs || [])]) {
      if (leg.userAccount) involved.add(leg.userAccount);
    }
    if (sw?.nativeInput?.account) involved.add(sw.nativeInput.account);
    if (sw?.nativeOutput?.account) involved.add(sw.nativeOutput.account);

    for (const addr of involved) {
      const wallet = wallets.get(addr);
      if (!wallet) continue;
      const ev = await parseHeliusTx(tx, wallet);
      if (ev) parsed.push(ev);
      break; // one event per tx
    }
  }

  // Enrich (symbol / market / anti-rug), then store (dedup) and alert only new.
  await Promise.allSettled(parsed.map((e) => enrichEvent(e)));
  const fresh = await addEvents(parsed);
  await Promise.allSettled(fresh.map((e) => sendAlert(e)));

  return NextResponse.json({
    ok: true,
    parsed: parsed.length,
    ingested: fresh.length,
  });
}

export function GET() {
  return NextResponse.json({ ok: true, message: "POST Helius enhanced webhooks here." });
}
