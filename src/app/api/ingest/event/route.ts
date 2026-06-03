import { NextResponse } from "next/server";
import { addEvents, type SmartEvent, type Chain } from "@/lib/server/store";
import type { Segment } from "@/lib/server/wallets";
import { enrichEvent } from "@/lib/server/enrich";
import { sendAlert } from "@/lib/server/alerts";
import { shortMint } from "@/lib/server/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chain-agnostic ingest. Push already-normalized events from any source/chain
 * (EVM indexers, other bots, manual). Solana has a dedicated Helius parser; this
 * is the path for BSC / Base / Ethereum / Tron. Auth = INGEST_SECRET.
 *
 * Body: an object or array of:
 *   { chain, wallet, action: "buy"|"sell", amountUsd, tokenMint?, token?,
 *     segment?, label?, ts?, txSig? }
 */
function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return auth === secret || url.searchParams.get("secret") === secret;
}

interface Incoming {
  chain?: Chain;
  wallet?: string;
  action?: "buy" | "sell";
  amountUsd?: number;
  tokenMint?: string;
  token?: string;
  segment?: Segment;
  label?: string;
  ts?: number;
  txSig?: string;
}

function shortWallet(a: string): string {
  return a.length > 9 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let items: Incoming[];
  try {
    const body = await req.json();
    items = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const events: SmartEvent[] = [];
  for (const i of items) {
    if (!i.wallet || (i.action !== "buy" && i.action !== "sell")) continue;
    if (!Number.isFinite(i.amountUsd) || (i.amountUsd as number) <= 0) continue;
    const chain = i.chain || "solana";
    const ts = i.ts ?? Date.now();
    const token = i.token || (i.tokenMint ? shortMint(i.tokenMint) : "?");
    const id = i.txSig
      ? `${i.txSig}_${i.wallet.slice(0, 6)}`
      : `${chain}-${i.wallet}-${ts}-${i.action}-${token}`;
    events.push({
      id,
      ts,
      chain,
      wallet: i.wallet,
      walletShort: shortWallet(i.wallet),
      label: i.label,
      segment: i.segment || "smart",
      action: i.action,
      token,
      tokenMint: i.tokenMint,
      amountUsd: Math.round(i.amountUsd as number),
      txSig: i.txSig,
    });
  }

  await Promise.allSettled(events.map((e) => enrichEvent(e)));
  const fresh = await addEvents(events);
  await Promise.allSettled(fresh.map((e) => sendAlert(e)));

  return NextResponse.json({ ok: true, ingested: fresh.length });
}
