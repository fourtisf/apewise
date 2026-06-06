import type { SmartEvent } from "./store";

/**
 * Live market fallback — when no tracked-wallet (Helius) events exist, show REAL
 * recent Solana trades from GeckoTerminal's free, no-key API so the terminal is
 * never just mock. These are public market trades (NOT scored "smart" wallets) —
 * the UI labels this mode "MARKET". KPIs use real 24h pool aggregates (not the
 * small trade sample). Fail-soft + cached.
 */
const BASE = "https://api.geckoterminal.com/api/v2";
const TTL = 45_000;

export interface MarketStats {
  volume24h: number;
  trades24h: number;
  traders24h: number;
  topToken: string;
}

export interface MarketSnapshot {
  events: SmartEvent[];
  stats: MarketStats;
}

let cache: { at: number; snap: MarketSnapshot | null } | null = null;

export interface PoolInfo {
  poolAddr: string;
  baseSymbol: string;
  baseMint: string;
  vol24: number;
  txns24: number;
  traders24: number;
  mcap?: number;
  liquidity?: number;
  change?: number;
}

export function parsePool(p: unknown): PoolInfo | null {
  const o = p as {
    attributes?: {
      address?: string;
      name?: string;
      fdv_usd?: string | number;
      market_cap_usd?: string | number;
      reserve_in_usd?: string | number;
      volume_usd?: { h24?: string | number };
      price_change_percentage?: { h24?: string | number };
      transactions?: {
        h24?: {
          buys?: string | number;
          sells?: string | number;
          buyers?: string | number;
          sellers?: string | number;
        };
      };
    };
    relationships?: { base_token?: { data?: { id?: string } } };
  };
  const a = o?.attributes;
  const baseId = o?.relationships?.base_token?.data?.id || "";
  const baseMint = baseId.includes("_")
    ? baseId.split("_").slice(1).join("_")
    : baseId;
  const symbol = (a?.name || "").split("/")[0]?.trim();
  if (!a?.address || !baseMint || !symbol) return null;

  const tx = a.transactions?.h24;
  return {
    poolAddr: a.address,
    baseSymbol: symbol,
    baseMint,
    vol24: Number(a.volume_usd?.h24 ?? 0) || 0,
    txns24: Number(tx?.buys ?? 0) + Number(tx?.sells ?? 0),
    traders24: Number(tx?.buyers ?? 0) + Number(tx?.sellers ?? 0),
    mcap:
      a.market_cap_usd != null
        ? Number(a.market_cap_usd)
        : a.fdv_usd != null
          ? Number(a.fdv_usd)
          : undefined,
    liquidity: a.reserve_in_usd != null ? Number(a.reserve_in_usd) : undefined,
    change:
      a.price_change_percentage?.h24 != null
        ? Number(a.price_change_percentage.h24)
        : undefined,
  };
}

export function tradeToEvent(t: unknown, pool: PoolInfo): SmartEvent | null {
  const a = (t as { attributes?: Record<string, unknown> })?.attributes;
  if (!a) return null;
  const usd = Number(a.volume_in_usd);
  const wallet = String(a.tx_from_address || "");
  if (!wallet || !Number.isFinite(usd) || usd <= 0) return null;
  const ts = a.block_timestamp ? Date.parse(String(a.block_timestamp)) : Date.now();
  const txHash = String(a.tx_hash || "tx");
  return {
    id: `${txHash}_${wallet.slice(0, 6)}_${pool.baseMint.slice(0, 4)}`,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    chain: "solana",
    wallet,
    walletShort:
      wallet.length > 9 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet,
    segment: "smart",
    action: a.kind === "sell" ? "sell" : "buy",
    token: pool.baseSymbol,
    tokenMint: pool.baseMint,
    amountUsd: Math.round(usd),
    marketCapUsd: pool.mcap,
    liquidityUsd: pool.liquidity,
  };
}

async function gt(path: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function build(): Promise<MarketSnapshot | null> {
  const trending = (await gt("/networks/solana/trending_pools?page=1")) as
    | { data?: unknown[] }
    | null;
  const pools = (trending?.data || [])
    .map(parsePool)
    .filter((p): p is PoolInfo => p != null);
  if (pools.length === 0) return null;

  // Real 24h aggregates across the trending market (not the small trade sample).
  const byVol = [...pools].sort((a, b) => b.vol24 - a.vol24);
  const stats: MarketStats = {
    volume24h: Math.round(pools.reduce((s, p) => s + p.vol24, 0)),
    trades24h: pools.reduce((s, p) => s + p.txns24, 0),
    traders24h: pools.reduce((s, p) => s + p.traders24, 0),
    topToken: byVol[0]?.baseSymbol || "—",
  };

  // Recent real trades for the feed (top pools, dust filtered, varied).
  const top = byVol.slice(0, 8);
  const tradeLists = await Promise.all(
    top.map((p) => gt(`/networks/solana/pools/${p.poolAddr}/trades`)),
  );
  const minUsd = Number(process.env.MIN_TRADE_USD) || 50;
  const all: SmartEvent[] = [];
  tradeLists.forEach((tl, i) => {
    const list = (tl as { data?: unknown[] } | null)?.data || [];
    // Convert ALL trades — GeckoTerminal's list order isn't guaranteed
    // newest-first, so slicing before sorting could surface stale trades.
    for (const t of list) {
      const ev = tradeToEvent(t, top[i]);
      if (ev && ev.amountUsd >= minUsd) all.push(ev);
    }
  });

  // Newest first, then drop anything stale so the LIVE feed never shows
  // hours-old trades (MARKET_MAX_AGE_MIN, default 180 min).
  all.sort((a, b) => b.ts - a.ts);
  const maxAgeMs = (Number(process.env.MARKET_MAX_AGE_MIN) || 180) * 60_000;
  const recent = all.filter((e) => Date.now() - e.ts < maxAgeMs);
  const fresh = recent.length ? recent : all;
  const perToken = new Map<string, number>();
  const events: SmartEvent[] = [];
  for (const e of fresh) {
    const c = perToken.get(e.token) || 0;
    if (c >= 4) continue;
    perToken.set(e.token, c + 1);
    events.push(e);
    if (events.length >= 40) break;
  }
  if (events.length === 0) return null;

  return { events, stats };
}

export async function getMarketSnapshot(): Promise<MarketSnapshot | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.snap;
  const snap = await build().catch(() => null);
  cache = { at: Date.now(), snap };
  return snap;
}
