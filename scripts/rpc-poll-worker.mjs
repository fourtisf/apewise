#!/usr/bin/env node
/**
 * Solana RPC poll worker — the free, no-Helius fallback.
 *
 * Polls tracked wallets for new swaps via the local /api/ingest/rpc-poll
 * endpoint on an interval, so smart-money trades flow into the terminal +
 * Telegram alerts WITHOUT a Helius webhook (and without its monthly credit cap).
 *
 * ⚠️  Pick ONE ingest mode. If you run the Helius webhook
 *     (scripts/setup-helius-webhook.mjs), STOP this worker —
 *     `pm2 stop apewise-rpc` — because polling pulls every wallet every cycle
 *     regardless of activity, so a paid RPC (Helius) burns credits here. This
 *     worker is meant for the FREE public RPC, when you have no Helius webhook.
 *
 * Run under PM2 (alongside `apewise` + `apewise-alerts`):
 *   pm2 start scripts/rpc-poll-worker.mjs --name apewise-rpc && pm2 save
 *
 * Tunables (env / .env): SOLANA_RPC_URL, RPC_POLL_INTERVAL_SEC (default 30),
 * RPC_SIGS_PER_WALLET, RPC_CALL_DELAY_MS, RPC_MAX_AGE_MIN, RPC_MAX_WALLETS.
 */
const port = process.env.PORT || 3000;
const secret = process.env.INGEST_SECRET || "";
const intervalMs = (Number(process.env.RPC_POLL_INTERVAL_SEC) || 30) * 1000;
const url = `http://localhost:${port}/api/ingest/rpc-poll${
  secret ? `?secret=${encodeURIComponent(secret)}` : ""
}`;

let busy = false; // a cycle can take a few seconds; never overlap ticks

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (j.ingested) {
      console.log(new Date().toISOString(), `ingested ${j.ingested}/${j.found}`);
    } else if (j.ok === false) {
      console.error("rpc-poll-worker:", j.error || r.status);
    }
  } catch (e) {
    console.error("rpc-poll-worker:", e.message);
  } finally {
    busy = false;
  }
}

console.log(`ApeWise RPC poll worker → ${url} every ${intervalMs / 1000}s`);
tick();
setInterval(tick, intervalMs);
