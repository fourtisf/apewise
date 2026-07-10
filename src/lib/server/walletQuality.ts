import type { Segment } from "./wallets";
import { allEvents } from "./store";
import { scoreWallets } from "./score";

/**
 * Per-wallet quality snapshot used to gate the *tweet* channel to proven
 * smart-money only. Derived from the same observed-swap history that powers
 * `score.ts`, so it improves as we collect more closed round-trips.
 *
 *   winRate      — % of closed positions in profit (needs `closedTrades` to matter)
 *   closedTrades — count of tokens with both a buy and a sell observed
 *   pnlUsd       — realized PnL across those closed positions (USD-at-swap proxy)
 *
 * `observed` is false until we've seen enough closed trades to trust the
 * numbers; callers decide whether to fall back to trusting the curated segment
 * (Birdeye/GMGN leaderboards are already win-rate ranked) at cold start.
 */
export interface WalletQuality {
  wallet: string;
  segment?: Segment;
  winRate: number;
  closedTrades: number;
  pnlUsd: number;
  trades: number;
  observed: boolean;
}

const MIN_CLOSED_FOR_OBSERVED =
  Number(process.env.TWEET_MIN_CLOSED_TRADES) || 4;

// Recompute at most every 30s — scoring the full ring buffer per candidate would
// be wasteful when a burst of webhooks lands together.
let cache: Map<string, WalletQuality> | null = null;
let cachedAt = 0;
const TTL = 30_000;

async function build(): Promise<Map<string, WalletQuality>> {
  const events = await allEvents();
  // limit = events.length → score every wallet, not just the top few.
  const scored = scoreWallets(events, events.length || 1);
  const map = new Map<string, WalletQuality>();

  // scoreWallets already folds buys/sells per wallet+token; re-derive the
  // closed-position count so we know how much to trust the win-rate.
  const closedByWallet = new Map<string, number>();
  const buysSells = new Map<string, Map<string, { buy: number; sell: number }>>();
  for (const e of events) {
    let toks = buysSells.get(e.wallet);
    if (!toks) {
      toks = new Map();
      buysSells.set(e.wallet, toks);
    }
    const key = e.tokenMint || e.token;
    const t = toks.get(key) || { buy: 0, sell: 0 };
    if (e.action === "buy") t.buy += e.amountUsd;
    else t.sell += e.amountUsd;
    toks.set(key, t);
  }
  for (const [wallet, toks] of buysSells) {
    let closed = 0;
    for (const t of toks.values()) if (t.buy > 0 && t.sell > 0) closed++;
    closedByWallet.set(wallet, closed);
  }

  for (const s of scored) {
    const closedTrades = closedByWallet.get(s.wallet) || 0;
    map.set(s.wallet, {
      wallet: s.wallet,
      segment: s.segment,
      winRate: s.winRate,
      closedTrades,
      pnlUsd: s.pnlUsd,
      trades: s.trades,
      observed: closedTrades >= MIN_CLOSED_FOR_OBSERVED,
    });
  }
  return map;
}

export async function walletQualityMap(): Promise<Map<string, WalletQuality>> {
  const now = Date.now();
  if (cache && now - cachedAt < TTL) return cache;
  cache = await build();
  cachedAt = now;
  return cache;
}

export async function getWalletQuality(
  wallet: string,
): Promise<WalletQuality | undefined> {
  return (await walletQualityMap()).get(wallet);
}
