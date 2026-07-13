#!/usr/bin/env node
/**
 * Always-on alert worker. Polls the local dispatch endpoint on an interval so new
 * notable trades get posted to the signals channel without anyone viewing the
 * terminal. Run under PM2:
 *
 *   pm2 start scripts/alert-worker.mjs --name apewise-alerts && pm2 save
 */
import { loadDotEnvLocal } from "./env.mjs";
await loadDotEnvLocal(); // plain node doesn't read .env.local — only Next does

const port = process.env.PORT || 3000;
const secret = process.env.INGEST_SECRET || "";
const intervalMs = (Number(process.env.ALERT_INTERVAL_SEC) || 60) * 1000;
const url = `http://localhost:${port}/api/alerts/dispatch${
  secret ? `?secret=${encodeURIComponent(secret)}` : ""
}`;

async function tick() {
  try {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      console.error(
        new Date().toISOString(),
        `alert-worker: dispatch failed (${r.status})`,
        j.error || "",
      );
      return;
    }
    if (j.posted) console.log(new Date().toISOString(), "posted", j.posted);
  } catch (e) {
    console.error("alert-worker:", e.message);
  }
}

// Never print the secret — PM2 logs get copied into issues/screenshots.
console.log(
  `ApeWise alert worker → ${url.replace(/secret=[^&]+/, "secret=***")} every ${intervalMs / 1000}s`,
);
tick();
setInterval(tick, intervalMs);
