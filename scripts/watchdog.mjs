#!/usr/bin/env node
/**
 * ApeWise watchdog — the "never goes quiet silently again" worker.
 *
 * Polls the app's /api/health on an interval. When the pipeline degrades or
 * stalls (ingestion dead, wallet set empty, Telegram sends failing, X auth
 * dead / usage-capped, app unreachable), it DMs the operator on Telegram —
 * once on the transition, then a reminder every WATCHDOG_REALERT_MIN while the
 * problem persists, and a recovery note when it clears. Run under PM2:
 *
 *   pm2 start scripts/watchdog.mjs --name apewise-watchdog && pm2 save
 *
 * Env:
 *   TELEGRAM_ADMIN_CHAT_ID   where alerts go — your own chat id with the bot
 *                            (DM the bot, then check https://api.telegram.org/bot<token>/getUpdates
 *                            or ask @userinfobot). REQUIRED for alerts; without
 *                            it the watchdog only logs.
 *   TELEGRAM_BOT_TOKEN       reused from the app config.
 *   WATCHDOG_INTERVAL_SEC    poll interval (default 300).
 *   WATCHDOG_REALERT_MIN     re-alert cadence while still broken (default 360).
 *   PORT / INGEST_SECRET     reused from the app config.
 *
 * The alert channel is a DM (not the signals channel) on purpose: if the
 * signals channel itself is what broke, posting the alarm there would fail too.
 */
import { loadEnv } from "./lib/env.mjs";
await loadEnv(); // pick up TELEGRAM_* / INGEST_SECRET from .env.local/.env

const port = process.env.PORT || 3000;
const secret = process.env.INGEST_SECRET || "";
const intervalMs = (Number(process.env.WATCHDOG_INTERVAL_SEC) || 300) * 1000;
const realertMs = (Number(process.env.WATCHDOG_REALERT_MIN) || 360) * 60_000;
const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const healthUrl = `http://localhost:${port}/api/health${
  secret ? `?secret=${encodeURIComponent(secret)}` : ""
}`;

let lastStatus = "ok"; // ok | degraded | stalled | unreachable
let lastAlertAt = 0;

async function notify(text) {
  console.error(`[watchdog] ${text.replace(/\n/g, " | ")}`);
  if (!adminChat || !token) return; // log-only mode
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: adminChat, text, parse_mode: "HTML" }),
    });
    if (!res.ok) console.error("[watchdog] alert send failed:", await res.text());
  } catch (e) {
    console.error("[watchdog] alert send failed:", e.message);
  }
}

async function check() {
  let status = "unreachable";
  let problems = ["app unreachable on localhost:" + port + " — pm2 restart apewise"];
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) {
      status = "degraded";
      problems = ["/api/health is 404 — old build running; redeploy (./deploy.sh)"];
    } else if (res.ok) {
      const j = await res.json();
      status = j.status || "ok";
      problems = j.problems || [];
    } else {
      status = "degraded";
      problems = [`/api/health HTTP ${res.status}`];
    }
  } catch {
    /* keep unreachable */
  }

  const now = Date.now();
  const broken = status !== "ok";
  const wasBroken = lastStatus !== "ok";

  if (broken && (!wasBroken || status !== lastStatus || now - lastAlertAt > realertMs)) {
    lastAlertAt = now;
    await notify(
      `🚨 <b>ApeWise pipeline ${status.toUpperCase()}</b>\n` +
        problems.map((p) => `• ${p}`).join("\n") +
        `\n\nRun on the server: <code>node scripts/doctor.mjs</code>`,
    );
  } else if (!broken && wasBroken) {
    await notify("✅ <b>ApeWise pipeline recovered</b> — posting is healthy again.");
  }
  if (!broken) lastAlertAt = 0;
  lastStatus = status;
}

console.log(
  `ApeWise watchdog → ${healthUrl} every ${intervalMs / 1000}s` +
    (adminChat ? ` (alerts → ${adminChat})` : " (LOG-ONLY: set TELEGRAM_ADMIN_CHAT_ID for alerts)"),
);
check();
setInterval(check, intervalMs);
