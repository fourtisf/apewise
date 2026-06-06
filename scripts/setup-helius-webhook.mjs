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
import { readFile, writeFile } from "node:fs/promises";

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
  const want = Math.max(1, Number(process.env.BIRDEYE_TRACK_LIMIT || 100));
  const PAGE = 10;
  const pages = Math.min(Math.ceil(want / PAGE), 30); // hard cap ~300
  const seen = new Set();
  for (let i = 0; i < pages && birdeye.length < want; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1300)); // free-tier rate limit
    const offset = i * PAGE;
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
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `Birdeye request failed (${res.status}) at offset ${offset}: ${body.slice(0, 300)}`,
        );
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
      if (page.length < PAGE) break; // last page
    } catch (e) {
      console.warn("Birdeye fetch failed:", e.message);
      break;
    }
  }
  console.log(`Birdeye: sourced ${birdeye.length} wallets`);
}

// Active traders on trending tokens (GeckoTerminal, free) — adds wallets that
// are ACTUALLY trading hot memecoins right now, so the feed isn't just quiet
// top-PnL whales. Set USE_ACTIVE_TRADERS=false to skip.
let active = [];
if (process.env.USE_ACTIVE_TRADERS !== "false") {
  const minUsd = Number(process.env.ACTIVE_MIN_USD || 1000);
  const wantPools = Math.max(1, Number(process.env.ACTIVE_POOLS || 15));
  try {
    const tp = await (
      await fetch(
        "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1",
        { headers: { accept: "application/json" } },
      )
    ).json();
    const pools = (tp?.data || [])
      .map((p) => p?.attributes?.address)
      .filter(Boolean)
      .slice(0, wantPools);
    const seen = new Set();
    for (const addr of pools) {
      try {
        const tr = await (
          await fetch(
            `https://api.geckoterminal.com/api/v2/networks/solana/pools/${addr}/trades`,
            { headers: { accept: "application/json" } },
          )
        ).json();
        for (const t of tr?.data || []) {
          const a = t?.attributes || {};
          const w = a.tx_from_address;
          if (w && (Number(a.volume_in_usd) || 0) >= minUsd && !seen.has(w)) {
            seen.add(w);
            active.push(w);
          }
        }
      } catch {
        /* skip this pool */
      }
      await new Promise((r) => setTimeout(r, 250)); // GeckoTerminal rate limit
    }
    console.log(`Active traders (GeckoTerminal): sourced ${active.length} wallets`);
  } catch (e) {
    console.warn("Active-trader source failed:", e.message);
  }
}

// Resolve the full tracked set WITH segments (manual wins on label/segment),
// and persist it so the app's walletMap matches exactly what the webhook
// tracks — otherwise live re-sourcing could recognize fewer wallets and drop
// their swaps. The app reads this file (see lib/server/wallets.ts).
const trackedMap = new Map();
for (const a of active)
  if (a) trackedMap.set(a, { address: a, label: "Active", segment: "smart" });
for (const a of [...birdeye, ...gmgn])
  if (a) trackedMap.set(a, { address: a, label: "Smart", segment: "smart" });
for (const w of manual) if (w?.address) trackedMap.set(w.address, w);
const tracked = [...trackedMap.values()];
const accountAddresses = tracked.map((w) => w.address);

try {
  await writeFile("data/tracked-wallets.json", JSON.stringify(tracked, null, 2));
  console.log(`Wrote data/tracked-wallets.json (${tracked.length} wallets)`);
} catch (e) {
  console.warn("Could not write data/tracked-wallets.json:", e.message);
}

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

// Idempotent: reuse (and de-dupe) any existing webhook for this URL instead of
// stacking a brand-new one on every run — otherwise Helius double-delivers swaps.
let existing = [];
try {
  const r = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`);
  if (r.ok) existing = await r.json();
} catch {
  /* ignore — fall back to create */
}
const mine = (Array.isArray(existing) ? existing : []).filter(
  (w) => w.webhookURL === webhookURL,
);
for (const dup of mine.slice(1)) {
  await fetch(
    `https://api.helius.xyz/v0/webhooks/${dup.webhookID}?api-key=${apiKey}`,
    { method: "DELETE" },
  ).catch(() => {});
  console.log(`🧹 Removed duplicate webhook ${dup.webhookID}`);
}
const keep = mine[0];

const res = await fetch(
  keep
    ? `https://api.helius.xyz/v0/webhooks/${keep.webhookID}?api-key=${apiKey}`
    : `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`,
  {
    method: keep ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  },
);
console.log(keep ? `Updated existing webhook ${keep.webhookID}` : "Created new webhook");

const respText = await res.text();
console.log("HTTP", res.status);
if (!res.ok) console.log(respText.slice(0, 500)); // only dump the body on error
console.log(
  `\nSources — birdeye ${birdeye.length}, active ${active.length}, gmgn ${gmgn.length}, manual ${manual.length}` +
    ` → ${accountAddresses.length} unique wallet(s).`,
);
if (res.ok) {
  console.log(`✓ Tracking ${accountAddresses.length} wallet(s) -> ${webhookURL}`);
} else {
  console.error(
    `✗ Helius webhook registration failed (HTTP ${res.status}). See body above.`,
  );
  process.exit(1);
}
