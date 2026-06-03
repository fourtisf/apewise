import { NextResponse } from "next/server";
import { allEvents } from "@/lib/server/store";
import { scoreWallets } from "@/lib/server/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Terminal data source. Returns real, derived metrics when ingested events exist
 * (`live: true`): the feed, KPIs, net inflows, and a PnL-scored wallet
 * leaderboard. Otherwise `live: false` and the client renders demo data.
 */
export async function GET() {
  const events = await allEvents();
  if (events.length === 0) {
    return NextResponse.json({
      live: false,
      events: [],
      kpis: null,
      inflows: [],
      topWallets: [],
    });
  }

  const now = Date.now();
  const day = events.filter((e) => now - e.ts < 24 * 3600 * 1000);
  const hour = events.filter((e) => now - e.ts < 3600 * 1000);
  const src = hour.length ? hour : day.length ? day : events;
  const base = day.length ? day : events;

  const feed = events.slice(0, 30).map((e) => ({
    id: e.id,
    wallet: e.walletShort,
    segment: e.segment,
    action: e.action,
    token: e.token,
    amountSol: e.amountSol ?? 0,
    amountUsd: e.amountUsd,
    ts: e.ts,
    chain: e.chain,
    marketCapUsd: e.marketCapUsd,
    liquidityUsd: e.liquidityUsd,
    riskVerdict: e.risk?.verdict,
  }));

  const tokVol = new Map<string, number>();
  for (const e of src) tokVol.set(e.token, (tokVol.get(e.token) || 0) + e.amountUsd);
  const topToken =
    [...tokVol.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
    events[0]?.token ||
    "—";

  const kpis = {
    volumeUsd: Math.round(base.reduce((s, e) => s + e.amountUsd, 0)),
    activeWallets: new Set(base.map((e) => e.wallet)).size,
    signals24h: base.length,
    topToken,
  };

  const inflowMap = new Map<
    string,
    { net: number; wallets: Set<string>; buys: number; trades: number }
  >();
  for (const e of src) {
    const m =
      inflowMap.get(e.token) ||
      { net: 0, wallets: new Set<string>(), buys: 0, trades: 0 };
    m.net += e.action === "buy" ? e.amountUsd : -e.amountUsd;
    m.wallets.add(e.wallet);
    m.trades++;
    if (e.action === "buy") m.buys++;
    inflowMap.set(e.token, m);
  }
  const inflows = [...inflowMap.entries()]
    .map(([token, m]) => ({
      token,
      netInflowUsd: Math.max(0, Math.round(m.net)),
      wallets: m.wallets.size,
      changePct: Math.round((m.buys / Math.max(1, m.trades)) * 100),
    }))
    .sort((a, b) => b.netInflowUsd - a.netInflowUsd)
    .slice(0, 6);

  const topWallets = scoreWallets(events, 6).map((w) => ({
    wallet: w.walletShort,
    segment: w.segment,
    winRate: w.winRate,
    pnlUsd: w.pnlUsd,
    trades: w.trades,
  }));

  return NextResponse.json({ live: true, events: feed, kpis, inflows, topWallets });
}
