import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuoteMint, shortMint } from "../src/lib/server/market.ts";

test("isQuoteMint flags WSOL + stables, not memecoins", () => {
  assert.equal(isQuoteMint("So11111111111111111111111111111111111111112"), true);
  assert.equal(isQuoteMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), true);
  assert.equal(isQuoteMint("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), false);
});

test("shortMint truncates long mints only", () => {
  assert.equal(
    shortMint("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
    "DezX…B263",
  );
  assert.equal(shortMint("abc"), "abc");
});
