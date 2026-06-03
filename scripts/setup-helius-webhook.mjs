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

let wallets;
try {
  wallets = JSON.parse(await readFile(walletsFile, "utf8"));
} catch {
  console.error(`Could not read ${walletsFile}. Copy smart-wallets.example.json there.`);
  process.exit(1);
}

const accountAddresses = wallets.map((w) => w.address).filter(Boolean);
if (accountAddresses.length === 0) {
  console.error(`No wallet addresses in ${walletsFile}.`);
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
