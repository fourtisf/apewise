import type { SmartWallet } from "./wallets";

/**
 * Smart-money leaderboard via Birdeye (key-based, no Cloudflare). Ranks Solana
 * traders by realized PnL. Requires BIRDEYE_API_KEY (free tier ~60 rpm). No-ops
 * if the key is missing; fail-soft + cached.
 */
const BASE = "https://public-api.birdeye.so";

function hdrs(): Record<string, string> {
  return {
    "X-API-KEY": process.env.BIRDEYE_API_KEY || "",
    "x-chain": "solana",
    accept: "application/json",
  };
}

export interface BirdeyeTrader {
  address: string;
  pnlUsd: number;
  volumeUsd: number;
  trades: number;
}

export function parseTrader(r: unknown): BirdeyeTrader | null {
  const o = (r ?? {}) as Record<string, unknown>;
  const address = (o.address || o.owner || o.wallet) as string | undefined;
  if (!address) return null;
  const n = (...keys: string[]): number => {
    for (const k of keys) {
      const v = Number(o[k]);
      if (Number.isFinite(v)) return v;
    }
    return 0;
  };
  return {
    address,
    pnlUsd: Math.round(n("pnl", "pnl_usd", "realized_pnl")),
    volumeUsd: Math.round(n("volume", "volume_usd", "trade_volume")),
    trades: Math.round(n("trade_count", "trades", "tx_count")),
  };
}

let cache: { at: number; traders: BirdeyeTrader[] } | null = null;
const TTL = 5 * 60_000;
const PAGE = 10; // gainers-losers caps at limit=10; over that returns 400.

/** Fetch one gainers-losers page (offset, limit=10). null = request failed. */
async function fetchPage(offset: number): Promise<BirdeyeTrader[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(
      `${BASE}/trader/gainers-losers?type=1W&sort_by=PnL&sort_type=desc&offset=${offset}&limit=${PAGE}`,
      { headers: hdrs(), signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    const d = json?.data as { items?: unknown[] } | unknown[] | undefined;
    const items = Array.isArray(d) ? d : d?.items || [];
    return (Array.isArray(items) ? items : [])
      .map(parseTrader)
      .filter((x): x is BirdeyeTrader => x != null && x.pnlUsd > 0);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function getTopTraders(limit = 10): Promise<BirdeyeTrader[]> {
  if (!process.env.BIRDEYE_API_KEY) return [];
  if (cache && Date.now() - cache.at < TTL && cache.traders.length >= limit)
    return cache.traders.slice(0, limit);

  // gainers-losers is capped at 10 rows/call, so page through offsets to track
  // more wallets. Fail-soft: stop at the first error/short/empty page, fall back
  // to cache. Hard cap at 10 pages (~100 wallets).
  const pages = Math.min(Math.ceil(Math.max(1, limit) / PAGE), 10);
  const seen = new Set<string>();
  const all: BirdeyeTrader[] = [];
  for (let i = 0; i < pages; i++) {
    const page = await fetchPage(i * PAGE);
    if (!page || page.length === 0) break;
    for (const tr of page) {
      if (!seen.has(tr.address)) {
        seen.add(tr.address);
        all.push(tr);
      }
    }
    if (page.length < PAGE) break; // last page
  }

  if (all.length) {
    cache = { at: Date.now(), traders: all };
    return all.slice(0, limit);
  }
  return cache?.traders.slice(0, limit) || [];
}

/** Birdeye top traders shaped for the tracked-wallet registry (Helius path). */
export async function getBirdeyeSmartWallets(limit = 50): Promise<SmartWallet[]> {
  const traders = await getTopTraders(limit);
  return traders.map((tr) => ({
    address: tr.address,
    label: "Smart",
    segment: "smart" as const,
  }));
}
