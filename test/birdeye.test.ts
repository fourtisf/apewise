import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrader } from "../src/lib/server/birdeye.ts";

test("parseTrader maps a gainers-losers row", () => {
  const t = parseTrader({
    address: "Tr8derBirdeye1111111111111111111111111111",
    pnl: 98765.4,
    volume: 250000,
    trade_count: 42,
  });
  assert.ok(t);
  assert.equal(t.address, "Tr8derBirdeye1111111111111111111111111111");
  assert.equal(t.pnlUsd, 98765);
  assert.equal(t.volumeUsd, 250000);
  assert.equal(t.trades, 42);
});

test("parseTrader tolerates alternate field names", () => {
  const t = parseTrader({ owner: "X", pnl_usd: 100, volume_usd: 50, tx_count: 3 });
  assert.equal(t?.address, "X");
  assert.equal(t?.pnlUsd, 100);
  assert.equal(t?.trades, 3);
});

test("parseTrader rejects rows without an address", () => {
  assert.equal(parseTrader({ pnl: 100 }), null);
});
