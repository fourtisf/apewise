#!/usr/bin/env node
/**
 * Always-on alert worker. Polls the local dispatch endpoint on an interval so new
 * notable trades get posted to the signals channel without anyone viewing the
 * terminal. Run under PM2:
 *
 *   pm2 start scripts/alert-worker.mjs --name apewise-alerts && pm2 save
 */
const port = process.env.PORT || 3000;
const secret = process.env.INGEST_SECRET || "";
const intervalMs = (Number(process.env.ALERT_INTERVAL_SEC) || 60) * 1000;
const url = `http://localhost:${port}/api/alerts/dispatch${
  secret ? `?secret=${encodeURIComponent(secret)}` : ""
}`;

async function tick() {
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (j.posted) console.log(new Date().toISOString(), "posted", j.posted);
  } catch (e) {
    console.error("alert-worker:", e.message);
  }
}

console.log(`ApeWise alert worker → ${url} every ${intervalMs / 1000}s`);
tick();
setInterval(tick, intervalMs);
