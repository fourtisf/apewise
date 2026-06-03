import { test } from "node:test";
import assert from "node:assert/strict";

// Isolate the store to a throwaway file, then import it (dynamic, so the env is
// set before the module captures EVENTS_FILE).
process.env.EVENTS_FILE = `/tmp/apewise-test-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2)}.jsonl`;
const { addEvents, allEvents } = await import("../src/lib/server/store.ts");

const mk = (id: string) =>
  ({
    id,
    ts: Date.now(),
    chain: "solana",
    wallet: "W",
    walletShort: "W…",
    segment: "smart",
    action: "buy",
    token: "T",
    amountUsd: 100,
  }) as never;

test("addEvents dedups by id and returns only fresh", async () => {
  const a = await addEvents([mk("x"), mk("y")]);
  assert.equal(a.length, 2);

  const b = await addEvents([mk("x"), mk("z")]); // x already stored
  assert.equal(b.length, 1);
  assert.equal(b[0].id, "z");

  const all = await allEvents();
  assert.equal(all.length, 3);
});
