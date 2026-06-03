import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGmgnWallet } from "../src/lib/server/gmgn.ts";

test("parseGmgnWallet maps a leaderboard row", () => {
  const w = parseGmgnWallet({
    wallet_address: "Wa11etGmgnTop11111111111111111111111111111",
    realized_profit_7d: 1234567.8,
    winrate_7d: 0.84,
    buy_7d: 120,
    sell_7d: 95,
    tags: ["smart_degen"],
  });
  assert.ok(w);
  assert.equal(w.address, "Wa11etGmgnTop11111111111111111111111111111");
  assert.equal(w.pnlUsd, 1234568);
  assert.equal(w.winRate, 84);
  assert.equal(w.trades, 215);
  assert.equal(w.segment, "smart");
});

test("parseGmgnWallet derives segment from tags", () => {
  assert.equal(parseGmgnWallet({ address: "a", tags: ["kol"] })?.segment, "kol");
  assert.equal(
    parseGmgnWallet({ address: "a", tags: ["snipe_bot"] })?.segment,
    "sniper",
  );
  assert.equal(parseGmgnWallet({ address: "a", tags: [] })?.segment, "smart");
});

test("parseGmgnWallet handles winrate as fraction or percent", () => {
  assert.equal(parseGmgnWallet({ address: "a", winrate_7d: 0.5 })?.winRate, 50);
  assert.equal(parseGmgnWallet({ address: "a", winrate: 73 })?.winRate, 73);
});

test("parseGmgnWallet rejects rows without an address", () => {
  assert.equal(parseGmgnWallet({ realized_profit_7d: 100 }), null);
});
