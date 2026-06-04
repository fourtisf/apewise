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

export async function getTopTraders(limit = 10): Promise<BirdeyeTrader[]> {
  if (!process.env.BIRDEYE_API_KEY) return [];
  if (cache && Date.now() - cache.at < TTL) return cache.traders.slice(0, limit);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    // gainers-losers caps at limit=10; over that returns 400.
    const res = await fetch(
      `${BASE}/trader/gainers-losers?type=1W&sort_by=PnL&sort_type=desc&offset=0&limit=10`,
      { headers: hdrs(), signal: ctrl.signal },
    );
    if (!res.ok) return cache?.traders.slice(0, limit) || [];
    const json = (await res.json()) as { data?: unknown };
    const d = json?.data as { items?: unknown[] } | unknown[] | undefined;
    const items = Array.isArray(d) ? d : d?.items || [];
    const traders = (Array.isArray(items) ? items : [])
      .map(parseTrader)
      .filter((x): x is BirdeyeTrader => x != null && x.pnlUsd > 0);
    if (traders.length) cache = { at: Date.now(), traders };
    return traders.slice(0, limit);
  } catch {
    return cache?.traders.slice(0, limit) || [];
  } finally {
    clearTimeout(t);
  }
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
