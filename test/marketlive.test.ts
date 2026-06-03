import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePool, tradeToEvent } from "../src/lib/server/marketLive.ts";

const poolFixture = {
  attributes: {
    address: "POOL_ADDR_123",
    name: "BONK / SOL",
    fdv_usd: "2100000",
    reserve_in_usd: "45000",
    volume_usd: { h24: "1234567" },
    price_change_percentage: { h24: "12.5" },
  },
  relationships: {
    base_token: {
      data: { id: "solana_DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
    },
  },
};

test("parsePool extracts symbol, mint, volume, mcap", () => {
  const p = parsePool(poolFixture);
  assert.ok(p);
  assert.equal(p.baseSymbol, "BONK");
  assert.equal(p.baseMint, "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  assert.equal(p.vol24, 1234567);
  assert.equal(p.mcap, 2100000);
  assert.equal(p.poolAddr, "POOL_ADDR_123");
});

test("parsePool rejects malformed pools", () => {
  assert.equal(parsePool({}), null);
  assert.equal(parsePool({ attributes: { address: "x" } }), null);
});

test("tradeToEvent builds a real buy event", () => {
  const p = parsePool(poolFixture)!;
  const ev = tradeToEvent(
    {
      attributes: {
        kind: "buy",
        volume_in_usd: "532.7",
        tx_from_address: "Trader1111111111111111111111111111111111111",
        block_timestamp: "2026-06-03T10:00:00Z",
        tx_hash: "abc123",
      },
    },
    p,
  );
  assert.ok(ev);
  assert.equal(ev.action, "buy");
  assert.equal(ev.token, "BONK");
  assert.equal(ev.tokenMint, "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  assert.equal(ev.amountUsd, 533);
  assert.equal(ev.walletShort, "Trad…1111");
});

test("tradeToEvent rejects zero/invalid volume", () => {
  const p = parsePool(poolFixture)!;
  assert.equal(
    tradeToEvent({ attributes: { kind: "buy", volume_in_usd: "0", tx_from_address: "x" } }, p),
    null,
  );
});
