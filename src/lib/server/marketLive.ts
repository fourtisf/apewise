import type { SmartEvent } from "./store";

/**
 * Live market fallback — when no tracked-wallet (Helius) events exist, show REAL
 * recent Solana trades from GeckoTerminal's free, no-key API so the terminal is
 * never just mock. These are public market trades (NOT scored "smart" wallets) —
 * the UI labels this mode "MARKET" accordingly. Fail-soft + cached.
 */
const BASE = "https://api.geckoterminal.com/api/v2";
const TTL = 45_000;

let cache: { at: number; events: SmartEvent[] | null } | null = null;

export interface PoolInfo {
  poolAddr: string;
  baseSymbol: string;
  baseMint: string;
  vol24: number;
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
    };
    relationships?: { base_token?: { data?: { id?: string } } };
  };
  const a = o?.attributes;
  const baseId = o?.relationships?.base_token?.data?.id || "";
  const baseMint = baseId.includes("_") ? baseId.split("_").slice(1).join("_") : baseId;
  const symbol = (a?.name || "").split("/")[0]?.trim();
  if (!a?.address || !baseMint || !symbol) return null;
  return {
    poolAddr: a.address,
    baseSymbol: symbol,
    baseMint,
    vol24: Number(a.volume_usd?.h24 ?? 0) || 0,
    mcap: a.market_cap_usd != null ? Number(a.market_cap_usd) : a.fdv_usd != null ? Number(a.fdv_usd) : undefined,
    liquidity: a.reserve_in_usd != null ? Number(a.reserve_in_usd) : undefined,
    change: a.price_change_percentage?.h24 != null ? Number(a.price_change_percentage.h24) : undefined,
  };
}

export function tradeToEvent(t: unknown, pool: PoolInfo): SmartEvent | null {
  const a = (t as { attributes?: Record<string, unknown> })?.attributes;
  if (!a) return null;
  const usd = Number(a.volume_in_usd);
  const wallet = String(a.tx_from_address || "");
  if (!wallet || !Number.isFinite(usd) || usd <= 0) return null;
  const ts = a.block_timestamp
    ? Date.parse(String(a.block_timestamp))
    : Date.now();
  const txHash = String(a.tx_hash || "tx");
  return {
    id: `${txHash}_${wallet.slice(0, 6)}_${pool.baseMint.slice(0, 4)}`,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    chain: "solana",
    wallet,
    walletShort: wallet.length > 9 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet,
    segment: "smart", // placeholder — market mode renders a neutral dot, no claim
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

async function build(): Promise<SmartEvent[] | null> {
  const trending = (await gt("/networks/solana/trending_pools?page=1")) as
    | { data?: unknown[] }
    | null;
  const pools = (trending?.data || [])
    .map(parsePool)
    .filter((p): p is PoolInfo => p != null)
    .slice(0, 8);
  if (pools.length === 0) return null;

  const top = pools.slice(0, 3);
  const tradeLists = await Promise.all(
    top.map((p) => gt(`/networks/solana/pools/${p.poolAddr}/trades`)),
  );

  const events: SmartEvent[] = [];
  tradeLists.forEach((tl, i) => {
    const list = (tl as { data?: unknown[] } | null)?.data || [];
    for (const t of list.slice(0, 14)) {
      const ev = tradeToEvent(t, top[i]);
      if (ev) events.push(ev);
    }
  });

  if (events.length === 0) return null;
  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, 40);
}

export async function getMarketSnapshot(): Promise<SmartEvent[] | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.events;
  const events = await build().catch(() => null);
  cache = { at: Date.now(), events };
  return events;
}
