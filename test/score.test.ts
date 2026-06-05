import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWallets } from "../src/lib/server/score.ts";

const ev = (o: {
  id: string;
  wallet: string;
  action: "buy" | "sell";
  token: string;
  usd: number;
}) =>
  ({
    id: o.id,
    ts: Date.now(),
    chain: "solana",
    wallet: o.wallet,
    walletShort: o.wallet.slice(0, 4),
    segment: "smart",
    action: o.action,
    token: o.token,
    tokenMint: o.token,
    amountUsd: o.usd,
  }) as never;

test("scoreWallets: realized PnL on a profitable round-trip", () => {
  const [w] = scoreWallets([
    ev({ id: "1", wallet: "WALLET_A", action: "buy", token: "AAA", usd: 1000 }),
    ev({ id: "2", wallet: "WALLET_A", action: "sell", token: "AAA", usd: 1800 }),
  ]);
  assert.equal(w.walletShort, "WALL");
  assert.equal(w.pnlUsd, 800);
  assert.equal(w.winRate, 100);
  assert.equal(w.trades, 2);
});

test("scoreWallets: a loss is not a win", () => {
  const [w] = scoreWallets([
    ev({ id: "3", wallet: "WALLET_B", action: "buy", token: "BBB", usd: 2000 }),
    ev({ id: "4", wallet: "WALLET_B", action: "sell", token: "BBB", usd: 500 }),
  ]);
  assert.equal(w.pnlUsd, -1500);
  assert.equal(w.winRate, 0);
});

test("scoreWallets ranks higher realized PnL first", () => {
  const top = scoreWallets([
    ev({ id: "a", wallet: "W1", action: "buy", token: "T", usd: 100 }),
    ev({ id: "b", wallet: "W1", action: "sell", token: "T", usd: 200 }),
    ev({ id: "c", wallet: "W2", action: "buy", token: "T", usd: 100 }),
    ev({ id: "d", wallet: "W2", action: "sell", token: "T", usd: 5000 }),
  ]);
  assert.ok(top[0].pnlUsd >= top[1].pnlUsd);
});

test("scoreWallets: volume sums both legs, even with no closed position", () => {
  // Only sells observed (the buy leg predates the window): PnL stays 0, but the
  // wallet still has real volume so the leaderboard can rank it (no false +$0).
  const [w] = scoreWallets([
    ev({ id: "s1", wallet: "W_SELL", action: "sell", token: "X", usd: 600 }),
    ev({ id: "s2", wallet: "W_SELL", action: "sell", token: "Y", usd: 400 }),
  ]);
  assert.equal(w.pnlUsd, 0);
  assert.equal(w.volumeUsd, 1000);
  assert.equal(w.trades, 2);
});

test("scoreWallets: with zero PnL everywhere, busiest-by-volume ranks first", () => {
  const top = scoreWallets([
    ev({ id: "1", wallet: "SMALL", action: "buy", token: "A", usd: 100 }),
    ev({ id: "2", wallet: "BIG", action: "buy", token: "B", usd: 9000 }),
  ]);
  assert.equal(top[0].pnlUsd, 0);
  assert.equal(top[0].walletShort, "BIG");
});
