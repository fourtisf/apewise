#!/usr/bin/env node
/**
 * Register (create) a Helius "enhanced" webhook for the tracked smart wallets,
 * pointing at the ApeWise ingest endpoint.
 *
 * Usage (from the app dir):
 *   HELIUS_API_KEY=xxx \
 *   WEBHOOK_URL=https://apewise.ai/api/ingest/helius \
 *   INGEST_SECRET=some-long-random-string \
 *   node scripts/setup-helius-webhook.mjs
 *
 * Wallets are read from data/smart-wallets.json (or $SMART_WALLETS_FILE).
 * Manage/delete webhooks later in the Helius dashboard.
 */
import { readFile } from "node:fs/promises";

const apiKey = process.env.HELIUS_API_KEY;
const webhookURL = process.env.WEBHOOK_URL;
const authHeader = process.env.INGEST_SECRET || "";
const walletsFile = process.env.SMART_WALLETS_FILE || "data/smart-wallets.json";

if (!apiKey || !webhookURL) {
  console.error("Set HELIUS_API_KEY and WEBHOOK_URL env vars.");
  process.exit(1);
}

let manual = [];
try {
  manual = JSON.parse(await readFile(walletsFile, "utf8"));
} catch {
  console.log(`(no ${walletsFile} — using GMGN-sourced wallets only)`);
}

// Auto-source smart wallets from GMGN (set USE_GMGN_WALLETS=false to skip).
let gmgn = [];
if (process.env.USE_GMGN_WALLETS !== "false") {
  try {
    const res = await fetch(
      "https://gmgn.ai/defi/quotation/v1/rank/sol/wallets/7d?orderby=pnl_7d&direction=desc",
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          accept: "application/json",
          referer: "https://gmgn.ai/",
        },
      },
    );
    if (res.ok) {
      const json = await res.json();
      const rank = json?.data?.rank || json?.data || [];
      gmgn = (Array.isArray(rank) ? rank : [])
        .slice(0, 50)
        .map((r) => r.wallet_address || r.address)
        .filter(Boolean);
      console.log(`GMGN: sourced ${gmgn.length} wallets`);
    } else {
      console.warn(`GMGN request failed (${res.status}) — Cloudflare may be blocking. Manual list only.`);
    }
  } catch (e) {
    console.warn("GMGN fetch failed:", e.message);
  }
}

// Auto-source from Birdeye (recommended — key-based, no Cloudflare).
let birdeye = [];
if (process.env.BIRDEYE_API_KEY) {
  try {
    const res = await fetch(
      "https://public-api.birdeye.so/trader/gainers-losers?type=1W&sort_by=PnL&sort_type=desc&offset=0&limit=10",
      {
        headers: {
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
          "x-chain": "solana",
          accept: "application/json",
        },
      },
    );
    if (res.ok) {
      const json = await res.json();
      const items = json?.data?.items || json?.data || [];
      birdeye = (Array.isArray(items) ? items : [])
        .map((t) => t.address || t.owner || t.wallet)
        .filter(Boolean);
      console.log(`Birdeye: sourced ${birdeye.length} wallets`);
    } else {
      console.warn(`Birdeye request failed (${res.status}).`);
    }
  } catch (e) {
    console.warn("Birdeye fetch failed:", e.message);
  }
}

const accountAddresses = [
  ...new Set(
    [...birdeye, ...gmgn, ...manual.map((w) => w.address)].filter(Boolean),
  ),
];
if (accountAddresses.length === 0) {
  console.error("No wallet addresses (GMGN blocked and no manual list).");
  process.exit(1);
}

const body = {
  webhookURL,
  transactionTypes: ["SWAP"],
  accountAddresses,
  webhookType: "enhanced",
  ...(authHeader ? { authHeader } : {}),
};

const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

console.log("HTTP", res.status);
console.log(await res.text());
console.log(`\nTracking ${accountAddresses.length} wallet(s) -> ${webhookURL}`);
