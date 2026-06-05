import { NextResponse } from "next/server";
import { allEvents, type SmartEvent } from "@/lib/server/store";
import { scoreWallets } from "@/lib/server/score";
import { getMarketSnapshot } from "@/lib/server/marketLive";
import { getGmgnTopWallets } from "@/lib/server/gmgn";
import { getTopTraders } from "@/lib/server/birdeye";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compute the feed + KPIs + net inflows from a set of events. */
function derive(events: SmartEvent[]) {
  const now = Date.now();
  const day = events.filter((e) => now - e.ts < 24 * 3600 * 1000);
  const hour = events.filter((e) => now - e.ts < 3600 * 1000);
  const src = hour.length ? hour : day.length ? day : events;
  // KPIs describe the real rolling 24h window — never silently widen to all-time,
  // which would let a stalled ingest keep reporting day-old swaps as "24h".
  const base = day;

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
    tokenMint: e.tokenMint,
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
      netInflowUsd: Math.round(m.net), // signed: negative = net outflow
      wallets: m.wallets.size,
      changePct: Math.round((m.buys / Math.max(1, m.trades)) * 100),
    }))
    .sort((a, b) => Math.abs(b.netInflowUsd) - Math.abs(a.netInflowUsd))
    .slice(0, 6);

  return { feed, kpis, inflows };
}

/** Build the scored smart-money leaderboard. Falls back to a volume ranking when
 *  no positions have closed yet (so the panel shows real $ instead of all "+$0"). */
function smartLeaderboard(tracked: SmartEvent[]) {
  const scored = scoreWallets(tracked, 50); // rank from a wide pool, slice to 6 below
  const hasPnl = scored.some((w) => w.pnlUsd !== 0);
  if (hasPnl) {
    return scored.slice(0, 6).map((w) => ({
      wallet: w.walletShort,
      segment: w.segment,
      winRate: w.winRate,
      pnlUsd: w.pnlUsd,
      trades: w.trades,
    }));
  }
  // No closed round-trips yet: rank by observed swap volume. The UI renders these
  // as "Top Traders · live" with the real $ figure (never a misleading +$0).
  return [...scored]
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, 6)
    .map((w) => ({
      wallet: w.walletShort,
      segment: w.segment,
      winRate: 0,
      pnlUsd: 0,
      trades: w.trades,
      volumeUsd: w.volumeUsd,
    }));
}

function smartResponse(tracked: SmartEvent[]) {
  const { feed, kpis, inflows } = derive(tracked);
  return NextResponse.json({
    live: true,
    source: "smart",
    events: feed,
    kpis,
    inflows,
    topWallets: smartLeaderboard(tracked),
  });
}

/**
 * Terminal data: scored smart-money (Helius/RPC) when fresh, else REAL Solana
 * market trades (GeckoTerminal, no key), else demo. `source` tells the UI which.
 *
 * Freshness gate: tracked events are only treated as "live smart money" while the
 * newest one is recent (TERMINAL_FRESH_MIN, default 45m). Once the ingest stalls
 * we yield to the live market feed instead of freezing on day-old swaps — that
 * was the "signals 25h ago / 3 active wallets" symptom.
 */
export async function GET() {
  const tracked = await allEvents();
  const freshMs = (Number(process.env.TERMINAL_FRESH_MIN) || 45) * 60_000;
  // Use the newest ts in the buffer, not tracked[0]: addEvents() prepends in
  // ingestion order (RPC batches are grouped by wallet, not globally sorted by
  // ts), so index 0 isn't guaranteed to be the most recent swap. A single
  // older-but-freshly-ingested event must not flip the terminal to market mode.
  let newestTs = 0;
  for (const e of tracked) if (e.ts > newestTs) newestTs = e.ts;
  const trackedFresh = tracked.length > 0 && Date.now() - newestTs <= freshMs;

  if (trackedFresh) return smartResponse(tracked);

  const market = await getMarketSnapshot();
  if (market && market.events.length > 0) {
    const { feed, inflows } = derive(market.events);
    const kpis = {
      volumeUsd: market.stats.volume24h,
      activeWallets: market.stats.traders24h,
      signals24h: market.stats.trades24h,
      topToken: market.stats.topToken,
    };

    // Prefer GMGN's smart-money leaderboard; if GMGN is blocked (Cloudflare),
    // rank the live traders by volume so the panel still shows real data.
    type Lb = {
      wallet: string;
      segment: string;
      winRate: number;
      pnlUsd: number;
      trades: number;
      volumeUsd?: number;
    };
    const short = (a: string) =>
      a.length > 9 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;

    // 1) Birdeye (PnL-ranked smart money; free key, no Cloudflare).
    let topWallets: Lb[] = (await getTopTraders(6)).map((tr) => ({
      wallet: short(tr.address),
      segment: "smart",
      winRate: 0,
      pnlUsd: tr.pnlUsd,
      trades: tr.trades,
    }));

    // 2) GMGN (often Cloudflare-blocked server-side).
    if (topWallets.length === 0) {
      topWallets = (await getGmgnTopWallets(6)).map((w) => ({
        wallet: short(w.address),
        segment: w.segment,
        winRate: w.winRate,
        pnlUsd: w.pnlUsd,
        trades: w.trades,
      }));
    }

    // 3) Live-volume fallback (always works from the market feed).
    if (topWallets.length === 0) {
      const agg = new Map<
        string,
        { vol: number; trades: number; short: string }
      >();
      for (const e of market.events) {
        const a = agg.get(e.wallet) || {
          vol: 0,
          trades: 0,
          short: e.walletShort,
        };
        a.vol += e.amountUsd;
        a.trades++;
        agg.set(e.wallet, a);
      }
      topWallets = [...agg.values()]
        .map((a) => ({
          wallet: a.short,
          segment: "smart",
          winRate: 0,
          pnlUsd: 0,
          trades: a.trades,
          volumeUsd: Math.round(a.vol),
        }))
        .sort((x, y) => (y.volumeUsd || 0) - (x.volumeUsd || 0))
        .slice(0, 6);
    }

    return NextResponse.json({
      live: true,
      source: "market",
      events: feed,
      kpis,
      inflows,
      topWallets,
    });
  }

  // Market source is also down: if we still hold (stale) tracked events, show
  // them rather than dropping all the way to demo.
  if (tracked.length > 0) return smartResponse(tracked);

  return NextResponse.json({
    live: false,
    source: "demo",
    events: [],
    kpis: null,
    inflows: [],
    topWallets: [],
  });
}
