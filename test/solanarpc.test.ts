import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRpcSwap, type RpcTx } from "../src/lib/server/solanaRpc.ts";

const W = "WaLLet1111111111111111111111111111111111111";
const MEME = "MeMe1111111111111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const wallet = { address: W, segment: "smart" as const, label: "Test" };

function tx(meta: RpcTx["meta"], sig = "Sig111"): RpcTx {
  return {
    blockTime: 1_700_000_000,
    transaction: { signatures: [sig], message: { accountKeys: [{ pubkey: W }] } },
    meta,
  };
}

test("parseRpcSwap: SOL buy (token up, SOL down) values via SOL price", () => {
  // spent 2 SOL + 5000 lamports fee; received 1000 MEME
  const ev = parseRpcSwap(
    tx({
      err: null,
      fee: 5000,
      preBalances: [5_000_000_000],
      postBalances: [2_999_995_000],
      preTokenBalances: [],
      postTokenBalances: [{ owner: W, mint: MEME, uiTokenAmount: { uiAmount: 1000 } }],
    }),
    wallet,
    150,
  );
  assert.ok(ev);
  assert.equal(ev.action, "buy");
  assert.equal(ev.tokenMint, MEME);
  assert.equal(ev.amountSol, 2);
  assert.equal(ev.amountUsd, 300);
  assert.equal(ev.txSig, "Sig111");
  assert.equal(ev.segment, "smart");
});

test("parseRpcSwap: SOL sell (token down, SOL up)", () => {
  // received 1.2 SOL (net of 5000 fee); sold 5000 MEME
  const ev = parseRpcSwap(
    tx({
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000],
      postBalances: [2_199_995_000],
      preTokenBalances: [{ owner: W, mint: MEME, uiTokenAmount: { uiAmount: 5000 } }],
      postTokenBalances: [{ owner: W, mint: MEME, uiTokenAmount: { uiAmount: 0 } }],
    }),
    wallet,
    150,
  );
  assert.ok(ev);
  assert.equal(ev.action, "sell");
  assert.equal(ev.amountSol, 1.2);
  assert.equal(ev.amountUsd, 180);
});

test("parseRpcSwap: stablecoin leg is taken as USD directly", () => {
  // spent 250 USDC; received 1000 MEME
  const ev = parseRpcSwap(
    tx({
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000],
      postBalances: [999_995_000],
      preTokenBalances: [{ owner: W, mint: USDC, uiTokenAmount: { uiAmount: 250 } }],
      postTokenBalances: [
        { owner: W, mint: USDC, uiTokenAmount: { uiAmount: 0 } },
        { owner: W, mint: MEME, uiTokenAmount: { uiAmount: 1000 } },
      ],
    }),
    wallet,
    150,
  );
  assert.ok(ev);
  assert.equal(ev.action, "buy");
  assert.equal(ev.amountUsd, 250); // USDC, not SOL×price
});

test("parseRpcSwap: non-swap (no token movement) → null", () => {
  const ev = parseRpcSwap(
    tx({
      err: null,
      fee: 5000,
      preBalances: [5_000_000_000],
      postBalances: [4_000_000_000],
      preTokenBalances: [],
      postTokenBalances: [],
    }),
    wallet,
    150,
  );
  assert.equal(ev, null);
});

test("parseRpcSwap: failed tx (meta.err) → null", () => {
  const ev = parseRpcSwap(
    tx({
      err: { InstructionError: [0, "Custom"] },
      fee: 5000,
      preBalances: [5_000_000_000],
      postBalances: [4_999_995_000],
      preTokenBalances: [],
      postTokenBalances: [{ owner: W, mint: MEME, uiTokenAmount: { uiAmount: 1000 } }],
    }),
    wallet,
    150,
  );
  assert.equal(ev, null);
});
