import type { SmartEvent } from "./store";
import type { Segment } from "./wallets";

export interface WalletScore {
  wallet: string;
  walletShort: string;
  label?: string;
  segment: Segment;
  winRate: number; // % of closed positions in profit
  pnlUsd: number; // realized PnL across closed positions (USD-at-swap proxy)
  trades: number;
  score: number; // ranking score
}

/**
 * Bootstrap wallet scoring from observed swaps. For each wallet+token we treat
 * total buy USD as cost and total sell USD as proceeds; a token with both sides
 * is a "closed" position with realized PnL = proceeds − cost. Win-rate is the
 * share of closed positions in profit. Approximate (USD-at-swap, no quantities)
 * and improves as more history is collected.
 * TODO: full FIFO PnL with token quantities + price history.
 */
export function scoreWallets(events: SmartEvent[], limit = 6): WalletScore[] {
  interface Agg {
    segment: Segment;
    label?: string;
    walletShort: string;
    trades: number;
    tokens: Map<string, { buy: number; sell: number }>;
  }
  const byWallet = new Map<string, Agg>();

  for (const e of events) {
    let a = byWallet.get(e.wallet);
    if (!a) {
      a = {
        segment: e.segment,
        label: e.label,
        walletShort: e.walletShort,
        trades: 0,
        tokens: new Map(),
      };
      byWallet.set(e.wallet, a);
    }
    a.trades++;
    const key = e.tokenMint || e.token;
    const t = a.tokens.get(key) || { buy: 0, sell: 0 };
    if (e.action === "buy") t.buy += e.amountUsd;
    else t.sell += e.amountUsd;
    a.tokens.set(key, t);
  }

  const scores: WalletScore[] = [];
  for (const [wallet, a] of byWallet) {
    let pnlUsd = 0;
    let closed = 0;
    let wins = 0;
    for (const t of a.tokens.values()) {
      if (t.buy > 0 && t.sell > 0) {
        const pnl = t.sell - t.buy;
        pnlUsd += pnl;
        closed++;
        if (pnl > 0) wins++;
      }
    }
    const winRate = closed > 0 ? Math.round((wins / closed) * 100) : 0;
    // Rank by realized PnL, lightly weighted by win-rate and activity.
    const score = pnlUsd * (0.5 + winRate / 200) + a.trades * 50;
    scores.push({
      wallet,
      walletShort: a.walletShort,
      label: a.label,
      segment: a.segment,
      winRate,
      pnlUsd: Math.round(pnlUsd),
      trades: a.trades,
      score,
    });
  }

  return scores.sort((x, y) => y.score - x.score).slice(0, limit);
}
