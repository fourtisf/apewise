#!/usr/bin/env node
/**
 * Always-on tweet worker. Polls the local tweet-dispatch endpoint on an interval
 * so the auto-tweet channel keeps posting (at most one, strictly-gated tweet per
 * tick) without anyone viewing the app. Run under PM2:
 *
 *   pm2 start scripts/tweet-worker.mjs --name apewise-tweets && pm2 save
 *
 * The dispatcher enforces its own pacing (min spacing + per-hour/day caps), so a
 * short poll interval here just means it *checks* often — it never over-posts.
 */
import { loadDotEnvLocal } from "./env.mjs";
await loadDotEnvLocal(); // plain node doesn't read .env.local — only Next does

const port = process.env.PORT || 3000;
const secret = process.env.INGEST_SECRET || "";
const intervalMs = (Number(process.env.TWEET_INTERVAL_SEC) || 60) * 1000;
const url = `http://localhost:${port}/api/tweets/dispatch${
  secret ? `?secret=${encodeURIComponent(secret)}` : ""
}`;

let lastBlocked = ""; // log each distinct block reason once, not every tick

async function tick() {
  try {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    // A 401 (secret mismatch) or 500 must be LOUD — this endpoint is the only
    // thing that ever posts a tweet, so a silent failure = a silent X account.
    if (!r.ok || j.ok === false) {
      console.error(
        new Date().toISOString(),
        `tweet-worker: dispatch failed (${r.status})`,
        j.error || "",
      );
      return;
    }
    if (j.posted) {
      console.log(new Date().toISOString(), "tweeted", j.posted);
    } else if (j.blocked && j.blocked !== "spacing" && j.blocked !== lastBlocked) {
      console.log(new Date().toISOString(), "blocked:", j.blocked);
    }
    lastBlocked = j.blocked || "";
  } catch (e) {
    console.error("tweet-worker:", e.message);
  }
}

// Never print the secret — PM2 logs get copied into issues/screenshots.
console.log(
  `ApeWise tweet worker → ${url.replace(/secret=[^&]+/, "secret=***")} every ${intervalMs / 1000}s`,
);
tick();
setInterval(tick, intervalMs);
