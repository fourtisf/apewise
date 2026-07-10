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
const port = process.env.PORT || 3000;
const secret = process.env.INGEST_SECRET || "";
const intervalMs = (Number(process.env.TWEET_INTERVAL_SEC) || 60) * 1000;
const url = `http://localhost:${port}/api/tweets/dispatch${
  secret ? `?secret=${encodeURIComponent(secret)}` : ""
}`;

async function tick() {
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (j.posted) console.log(new Date().toISOString(), "tweeted", j.posted);
  } catch (e) {
    console.error("tweet-worker:", e.message);
  }
}

console.log(`ApeWise tweet worker → ${url} every ${intervalMs / 1000}s`);
tick();
setInterval(tick, intervalMs);
