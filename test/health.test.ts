import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveVerdict,
  DEFAULT_THRESHOLDS,
  type HealthSnapshot,
} from "../src/lib/server/health.ts";

const NOW = 1_800_000_000_000;
const min = 60_000;

const snap = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  startedAt: NOW - 60 * min,
  ingest: { rpc: { cycles: 0, allFailStreak: 0 }, ...(over.ingest || {}) },
  telegram: { ok: 0, fail: 0, failStreak: 0, ...(over.telegram || {}) },
  twitter: { ok: 0, fail: 0, failStreak: 0, ...(over.twitter || {}) },
  tweetDispatch: over.tweetDispatch || {},
});

test("deriveVerdict: freshly-booted process with no signals yet is ok", () => {
  const v = deriveVerdict({ ...snap(), startedAt: NOW - 5 * min }, NOW);
  assert.equal(v.status, "ok");
  assert.deepEqual(v.problems, []);
});

test("deriveVerdict: no ingest tick long after boot degrades (dead worker was invisible)", () => {
  const v = deriveVerdict({ ...snap(), startedAt: NOW - 60 * min }, NOW);
  assert.equal(v.status, "degraded");
  assert.ok(v.problems.some((p) => p.startsWith("ingest-silent")));
});

test("deriveVerdict: healthy active pipeline is ok", () => {
  const v = deriveVerdict(
    snap({
      ingest: {
        lastRxAt: NOW - 1 * min,
        lastEventAt: NOW - 10 * min,
        walletCount: 120,
        rpc: { cycles: 50, lastCycleAt: NOW - 1 * min, allFailStreak: 0 },
      },
      telegram: { ok: 10, fail: 0, failStreak: 0, lastOkAt: NOW - 5 * min },
      twitter: { ok: 3, fail: 0, failStreak: 0, lastOkAt: NOW - 30 * min },
    }),
    NOW,
  );
  assert.equal(v.status, "ok");
});

test("deriveVerdict: empty wallet set is stalled", () => {
  const v = deriveVerdict(snap({ ingest: { walletCount: 0, rpc: { cycles: 1, allFailStreak: 0 } } }), NOW);
  assert.equal(v.status, "stalled");
  assert.ok(v.problems.some((p) => p.startsWith("wallets-empty")));
});

test("deriveVerdict: ingest activity stops -> stalled (but silence-from-birth doesn't)", () => {
  const stale = deriveVerdict(
    snap({
      ingest: {
        lastRxAt: NOW - 45 * min,
        walletCount: 50,
        rpc: { cycles: 10, lastCycleAt: NOW - 45 * min, allFailStreak: 0 },
      },
    }),
    NOW,
  );
  assert.equal(stale.status, "stalled");
  assert.ok(stale.problems.some((p) => p.startsWith("ingest-stalled")));

  // Webhook mode with zero traffic since boot: soft warning, never hard-stalled
  // (a quiet market is indistinguishable from a dead webhook without Helius).
  const silent = deriveVerdict(snap({ ingest: { walletCount: 50, rpc: { cycles: 0, allFailStreak: 0 } } }), NOW);
  assert.equal(silent.status, "degraded");
  assert.ok(silent.problems.some((p) => p.startsWith("ingest-silent")));
});

test("deriveVerdict: RPC all-fail streak is stalled", () => {
  const v = deriveVerdict(
    snap({
      ingest: {
        lastRxAt: NOW - 1 * min,
        walletCount: 50,
        rpc: {
          cycles: 20,
          lastCycleAt: NOW - 1 * min,
          allFailStreak: DEFAULT_THRESHOLDS.rpcFailStreak,
          url: "https://api.mainnet-beta.solana.com",
        },
      },
    }),
    NOW,
  );
  assert.equal(v.status, "stalled");
  assert.ok(v.problems.some((p) => p.startsWith("rpc-dead")));
});

test("deriveVerdict: X auth death / usage cap are stalled; generic X failures degrade", () => {
  const auth = deriveVerdict(
    snap({ twitter: { ok: 5, fail: 3, failStreak: 3, authFailed: true } }),
    NOW,
  );
  assert.equal(auth.status, "stalled");
  assert.ok(auth.problems.some((p) => p.startsWith("x-auth-failed")));

  const capped = deriveVerdict(
    snap({ twitter: { ok: 5, fail: 3, failStreak: 3, capped: true } }),
    NOW,
  );
  assert.equal(capped.status, "stalled");
  assert.ok(capped.problems.some((p) => p.startsWith("x-usage-capped")));

  const flaky = deriveVerdict(
    snap({ twitter: { ok: 5, fail: 3, failStreak: 3, lastError: "network" } }),
    NOW,
  );
  assert.equal(flaky.status, "degraded");
  assert.ok(flaky.problems.some((p) => p.startsWith("twitter-failing")));
});

test("deriveVerdict: telegram failure streak is stalled", () => {
  const v = deriveVerdict(
    snap({ telegram: { ok: 100, fail: 3, failStreak: 3, lastError: "403 kicked" } }),
    NOW,
  );
  assert.equal(v.status, "stalled");
  assert.ok(v.problems.some((p) => p.startsWith("telegram-failing")));
});

test("deriveVerdict: long event drought degrades (quiet market vs dead pipeline)", () => {
  const v = deriveVerdict(
    snap({
      ingest: {
        lastRxAt: NOW - 1 * min, // ingest is alive...
        lastEventAt: NOW - 7 * 60 * min, // ...but nothing stored for 7h
        walletCount: 50,
        rpc: { cycles: 100, lastCycleAt: NOW - 1 * min, allFailStreak: 0 },
      },
    }),
    NOW,
  );
  assert.equal(v.status, "degraded");
  assert.ok(v.problems.some((p) => p.startsWith("events-quiet")));
});

test("deriveVerdict: custom thresholds are honored", () => {
  const v = deriveVerdict(
    snap({ telegram: { ok: 0, fail: 2, failStreak: 2 } }),
    NOW,
    { ...DEFAULT_THRESHOLDS, channelFailStreak: 2 },
  );
  assert.equal(v.status, "stalled");
});
