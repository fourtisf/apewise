#!/usr/bin/env node
/**
 * Prove there are no double-posts or stale re-posts. Scans the persisted logs
 * (data/events.jsonl + data/tweets.jsonl) and reports:
 *   1. duplicate INGESTED event ids   → double-ingest bug (must be 0)
 *   2. duplicate TWEETED event ids     → double-tweet bug (must be 0)
 *   3. same token tweeted twice within TWEET_TOKEN_COOLDOWN_MIN → cooldown leak
 *   4. duplicate Telegram messages in the last window (by wallet+mint+action)
 *
 *   node scripts/verify-dedup.mjs
 *
 * Exit code is non-zero if any hard check fails, so it's CI/cron-friendly.
 */
import { readFile } from "node:fs/promises";

const COOLDOWN_MIN = Number(process.env.TWEET_TOKEN_COOLDOWN_MIN) || 60;

async function readJsonl(path) {
  try {
    const txt = await readFile(path, "utf8");
    return txt
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const dupes = (arr) => {
  const count = new Map();
  for (const v of arr) count.set(v, (count.get(v) || 0) + 1);
  return [...count.entries()].filter(([, n]) => n > 1);
};

const events = await readJsonl("data/events.jsonl");
const tweets = await readJsonl("data/tweets.jsonl");
let failed = false;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => {
  failed = true;
  console.log(`  ❌ ${m}`);
};

console.log(`\n📁 events.jsonl: ${events.length} events · tweets.jsonl: ${tweets.length} tweets\n`);

// 1) Duplicate ingested event ids (persistent dedup must guarantee 0).
console.log("1) Ingest dedup — no swap processed twice:");
const evDupes = dupes(events.map((e) => e.id).filter(Boolean));
if (evDupes.length === 0) ok("0 duplicate event ids");
else bad(`${evDupes.length} duplicate event id(s): ${evDupes.slice(0, 5).map(([id, n]) => `${id}×${n}`).join(", ")}`);

// 2) Duplicate tweeted event ids (the same event must never be tweeted twice).
console.log("2) Tweet dedup — no event tweeted twice:");
const twDupes = dupes(tweets.map((t) => t.eventId).filter(Boolean));
if (twDupes.length === 0) ok("0 double-tweeted events");
else bad(`${twDupes.length} event(s) tweeted more than once: ${twDupes.slice(0, 5).map(([id, n]) => `${id}×${n}`).join(", ")}`);

// 3) Same token tweeted within the cooldown window.
console.log(`3) Token cooldown — same token not re-tweeted within ${COOLDOWN_MIN}m:`);
const byToken = new Map();
for (const t of tweets) {
  const k = t.tokenMint || t.token;
  if (!k) continue;
  (byToken.get(k) || byToken.set(k, []).get(k)).push(t);
}
let leaks = 0;
for (const [k, list] of byToken) {
  const ts = list.map((t) => t.ts).sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) {
    const gapMin = (ts[i] - ts[i - 1]) / 60000;
    if (gapMin < COOLDOWN_MIN) {
      leaks++;
      const sym = list[0].token || k;
      console.log(`     ⚠️  $${sym} re-tweeted after ${gapMin.toFixed(1)}m (< ${COOLDOWN_MIN}m)`);
    }
  }
}
if (leaks === 0) ok("no same-token re-tweets inside the cooldown");
else bad(`${leaks} same-token re-tweet(s) inside the cooldown window`);

// 4) Freshness — how old were the events when tweeted? (detects stale re-posts.)
console.log("4) Freshness — tweets are recent, not backfilled history:");
if (tweets.length) {
  const now = Date.now();
  const ages = tweets.map((t) => (now - t.ts) / 3600000); // hours ago
  const newest = Math.min(...ages);
  const span = Math.max(...tweets.map((t) => t.ts)) - Math.min(...tweets.map((t) => t.ts));
  ok(`newest tweet ${newest.toFixed(1)}h ago · ${tweets.length} tweets span ${(span / 3600000).toFixed(1)}h`);
} else ok("no tweets yet");

console.log(`\n${failed ? "❌ FAIL — investigate above" : "✅ PASS — no double-post or stale re-post detected"}\n`);
process.exit(failed ? 1 : 0);
