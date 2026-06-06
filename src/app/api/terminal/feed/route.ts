import { NextResponse } from "next/server";
import { allEvents, type SmartEvent } from "@/lib/server/store";
import { scoreWallets } from "@/lib/server/score";
import { getMarketSnapshot } from "@/lib/server/marketLive";
import { getGmgnTopWallets } from "@/lib/server/gmgn";
import { getTopTraders } from "@/lib/server/birdeye";
import { getSmartWallets } from "@/lib/server/wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compute the feed + KPIs + net inflows from a set of events. */
function derive(events: SmartEvent[]) {
  const now = Date.now();
  const day = events.filter((e) => now - e.ts < 24 * 3600 * 1000);
  const hour = events.filter((e) => now - e.ts < 3600 * 1000);
  const src = hour.length ? hour : day.length ? day : events;
  const base = day.length ? day : events;

  const feed = events.slice(0, 30).map((e) => ({
    id: e.id,
    wallet: e.walletShort,
    walletAddress: e.wallet,
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

/**
 * Terminal data: scored smart-money (Helius) when configured, else REAL Solana
 * market trades (GeckoTerminal, no key), else demo. `source` tells the UI which.
 */
export async function GET() {
  const tracked = await allEvents();
  // Only treat tracked smart-money data as "live" while it's fresh. If the
  // ingest poller stalls (no new swaps for a while), fall through to the
  // real-time market snapshot so the terminal never shows hours-old rows.
  const freshMin = Number(process.env.FEED_FRESH_MIN) || 30;
  const isFresh =
    tracked.length > 0 && Date.now() - tracked[0].ts < freshMin * 60_000;
  if (isFresh) {
    const { feed, kpis, inflows } = derive(tracked);
    const topWallets = scoreWallets(tracked, 6).map((w) => ({
      wallet: w.walletShort,
      segment: w.segment,
      winRate: w.winRate,
      pnlUsd: w.pnlUsd,
      trades: w.trades,
    }));
    const trackedWallets = (await getSmartWallets()).length;
    return NextResponse.json({
      live: true,
      source: "smart",
      events: feed,
      kpis,
      inflows,
      topWallets,
      trackedWallets,
    });
  }

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

  return NextResponse.json({
    live: false,
    source: "demo",
    events: [],
    kpis: null,
    inflows: [],
    topWallets: [],
  });
}
