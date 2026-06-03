import type { Segment, SmartWallet } from "./wallets";

/**
 * Source smart-money wallets from GMGN's public leaderboard (Solana, ranked by
 * 7d realized PnL). NOTE: GMGN sits behind Cloudflare — server requests may be
 * blocked (403). We send browser-like headers and fail soft (return cached/empty)
 * so nothing breaks; the terminal just falls back. Cached 5 min.
 */
const BASE = "https://gmgn.ai/defi/quotation/v1";
const HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  accept: "application/json",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://gmgn.ai/",
};

export interface GmgnWallet {
  address: string;
  label?: string;
  segment: Segment;
  pnlUsd: number;
  winRate: number;
  trades: number;
}

function deriveSegment(tags: string[]): Segment {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes("kol"))) return "kol";
  if (t.some((x) => x.includes("snip") || x.includes("bot"))) return "sniper";
  if (t.some((x) => x.includes("insider") || x.includes("dev"))) return "insider";
  return "smart";
}

export function parseGmgnWallet(r: unknown): GmgnWallet | null {
  const o = (r ?? {}) as Record<string, unknown>;
  const address = (o.wallet_address || o.address) as string | undefined;
  if (!address) return null;

  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = Number(o[k]);
      if (Number.isFinite(v) && v !== 0) return v;
    }
    return 0;
  };

  const pnl = num("realized_profit_7d", "pnl_7d", "profit_7d", "realized_profit");
  const wrRaw = num("winrate_7d", "winrate", "win_rate");
  const winRate =
    wrRaw > 0 && wrRaw <= 1 ? Math.round(wrRaw * 100) : Math.round(wrRaw);
  const trades =
    num("txs_7d", "txs") ||
    Number(o.buy_7d || 0) + Number(o.sell_7d || 0);
  const tags = Array.isArray(o.tags) ? (o.tags as unknown[]).map(String) : [];
  const twitter = (o.twitter_username || o.twitter_name) as string | undefined;

  return {
    address,
    label: twitter ? `@${twitter}` : undefined,
    segment: deriveSegment(tags),
    pnlUsd: Math.round(pnl),
    winRate,
    trades: Math.round(trades),
  };
}

let cache: { at: number; wallets: GmgnWallet[] } | null = null;
const TTL = 5 * 60_000;

export async function getGmgnTopWallets(limit = 20): Promise<GmgnWallet[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.wallets.slice(0, limit);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(
      `${BASE}/rank/sol/wallets/7d?orderby=pnl_7d&direction=desc`,
      { headers: HEADERS, signal: ctrl.signal },
    );
    if (!res.ok) return cache?.wallets.slice(0, limit) || [];
    const json = (await res.json()) as { data?: unknown };
    const d = json?.data as { rank?: unknown[] } | unknown[] | undefined;
    const rank = Array.isArray(d) ? d : d?.rank || [];
    const wallets = (Array.isArray(rank) ? rank : [])
      .map(parseGmgnWallet)
      .filter((w): w is GmgnWallet => w != null);
    if (wallets.length) cache = { at: Date.now(), wallets };
    return wallets.slice(0, limit);
  } catch {
    return cache?.wallets.slice(0, limit) || [];
  } finally {
    clearTimeout(t);
  }
}

/** GMGN wallets shaped for the tracked-wallet registry (Helius path). */
export async function getGmgnSmartWallets(limit = 50): Promise<SmartWallet[]> {
  const wallets = await getGmgnTopWallets(limit);
  return wallets.map((w) => ({
    address: w.address,
    label: w.label || `Smart (${w.winRate}% win)`,
    segment: w.segment,
  }));
}
