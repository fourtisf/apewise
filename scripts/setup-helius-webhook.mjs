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
 * Re-running is safe: after creating the fresh webhook it removes any older
 * webhook(s) for the same URL, so duplicates never pile up (a duplicate would
 * make Helius deliver every swap twice → duplicate alerts + wasted credits).
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
// gainers-losers caps at limit=10, so page through offsets to track more
// (BIRDEYE_TRACK_LIMIT, default 50). On failure we print the response body so a
// 400/401 is diagnosable (bad key, unsubscribed package, wrong param, …).
let birdeye = [];
if (process.env.BIRDEYE_API_KEY) {
  const want = Math.max(1, Number(process.env.BIRDEYE_TRACK_LIMIT || 50));
  const PAGE = 10;
  const pageDelayMs = Number(process.env.BIRDEYE_PAGE_DELAY_MS) || 600;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pages = Math.min(Math.ceil(want / PAGE), 10); // hard cap ~100
  const seen = new Set();
  let stop = false;
  for (let i = 0; i < pages && birdeye.length < want && !stop; i++) {
    const offset = i * PAGE;
    if (i > 0) await sleep(pageDelayMs); // free tier ~1 rps — pace the pages
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://public-api.birdeye.so/trader/gainers-losers?type=1W&sort_by=PnL&sort_type=desc&offset=${offset}&limit=${PAGE}`,
          {
            headers: {
              "X-API-KEY": process.env.BIRDEYE_API_KEY,
              "x-chain": "solana",
              accept: "application/json",
            },
          },
        );
        if (res.status === 429 && attempt === 0) {
          await sleep(1500); // back off once on rate-limit, then retry this page
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.warn(
            `Birdeye request failed (${res.status}) at offset ${offset}: ${body.slice(0, 300)}`,
          );
          stop = true;
          break;
        }
        const json = await res.json();
        const items = json?.data?.items || json?.data || [];
        const page = (Array.isArray(items) ? items : [])
          .map((t) => t.address || t.owner || t.wallet)
          .filter(Boolean);
        for (const a of page) {
          if (!seen.has(a)) {
            seen.add(a);
            birdeye.push(a);
          }
        }
        if (page.length < PAGE) stop = true; // last page
        break;
      } catch (e) {
        console.warn("Birdeye fetch failed:", e.message);
        stop = true;
        break;
      }
    }
  }
  console.log(`Birdeye: sourced ${birdeye.length} wallets`);
}

const accountAddresses = [
  ...new Set(
    [...birdeye, ...gmgn, ...manual.map((w) => w.address)].filter(Boolean),
  ),
];
if (accountAddresses.length === 0) {
  console.error(
    "No wallet addresses to track. Auto-source failed (Birdeye + GMGN) and no " +
      `manual list found at ${walletsFile}. Create it with real addresses:\n` +
      '  [{ "address": "...", "label": "Whale 1", "segment": "smart" }]',
  );
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

const text = await res.text();
console.log("HTTP", res.status);
console.log(text);
console.log(
  `\nSources — birdeye ${birdeye.length}, gmgn ${gmgn.length}, manual ${manual.length}` +
    ` → ${accountAddresses.length} unique wallet(s).`,
);
if (!res.ok) {
  console.error(
    `✗ Helius webhook registration failed (HTTP ${res.status}). See body above.`,
  );
  process.exit(1);
}

// Idempotent cleanup: the fresh webhook now exists, so delete any OTHER webhook
// pointing at the same URL (leftovers from previous runs). Re-running therefore
// converges to exactly one webhook instead of piling up duplicates. Done AFTER a
// successful create so a failure never leaves us with zero webhooks.
let newID;
try {
  newID = JSON.parse(text)?.webhookID;
} catch {
  /* non-JSON body — skip cleanup */
}
if (newID) {
  try {
    const listRes = await fetch(
      `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`,
    );
    if (listRes.ok) {
      const all = await listRes.json();
      const stale = (Array.isArray(all) ? all : []).filter(
        (w) => w?.webhookURL === webhookURL && w?.webhookID !== newID,
      );
      for (const w of stale) {
        const del = await fetch(
          `https://api.helius.xyz/v0/webhooks/${w.webhookID}?api-key=${apiKey}`,
          { method: "DELETE" },
        );
        console.log(
          `Removed stale webhook ${w.webhookID} (${del.ok ? "ok" : "HTTP " + del.status})`,
        );
      }
    }
  } catch (e) {
    console.warn("Stale-webhook cleanup skipped:", e.message);
  }
}

console.log(`✓ Tracking ${accountAddresses.length} wallet(s) -> ${webhookURL}`);
