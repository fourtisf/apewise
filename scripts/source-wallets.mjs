#!/usr/bin/env node
/**
 * Source a smart-money wallet set WITHOUT Helius, and persist it to
 * data/tracked-wallets.json (which the app's walletMap reads — see
 * lib/server/wallets.ts). The RPC poll worker (scripts/rpc-poll-worker.mjs)
 * then polls exactly these wallets over a free public RPC — no webhook, no
 * Helius credit cap.
 *
 * Sources (all free, fail-soft):
 *   1. Active traders on trending memecoins (GeckoTerminal) — most reliable
 *   2. GMGN 7d PnL leaderboard (Cloudflare may block server-side)
 *   3. Birdeye gainers/losers (needs BIRDEYE_API_KEY — best quality, no Cloudflare)
 * Manual picks in data/smart-wallets.json always win on label/segment.
 *
 *   node scripts/source-wallets.mjs
 *
 * Tunables: ACTIVE_MIN_USD (1000), ACTIVE_POOLS (60), USE_GMGN_WALLETS,
 * GMGN_TRACK_LIMIT (100), BIRDEYE_API_KEY, BIRDEYE_TRACK_LIMIT (200).
 * The RPC poller covers a large set via a rotating window (RPC_MAX_WALLETS per
 * cycle), so a few hundred tracked wallets is fine — bump the limits above.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

/**
 * Load .env.local into process.env (plain `node` doesn't read it — only Next
 * does). Without this, BIRDEYE_API_KEY lives in .env.local but is invisible to
 * this script, so the Birdeye source silently no-ops and we can end up sourcing
 * zero wallets. Existing env vars win, so an inline override still takes effect.
 */
async function loadDotEnvLocal() {
  let txt = "";
  try {
    txt = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    try {
      txt = await readFile(".env.local", "utf8"); // fallback: cwd
    } catch {
      return;
    }
  }
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
await loadDotEnvLocal();

const walletsFile = process.env.SMART_WALLETS_FILE || "data/smart-wallets.json";

let manual = [];
try {
  manual = JSON.parse(await readFile(walletsFile, "utf8"));
} catch {
  /* no manual list — auto-source only */
}

// 1) Active traders on trending tokens (GeckoTerminal, free, reliable).
let active = [];
if (process.env.USE_ACTIVE_TRADERS !== "false") {
  const minUsd = Number(process.env.ACTIVE_MIN_USD || 1000);
  const wantPools = Math.max(1, Number(process.env.ACTIVE_POOLS || 60));
  try {
    // Pull pools from several lists/pages so we sample a wide, fresh cross
    // section of the market instead of just the current top-20 trending.
    const listUrls = [
      "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1",
      "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=2",
      "https://api.geckoterminal.com/api/v2/networks/solana/pools?page=1", // top by volume
      "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1",
    ];
    const poolSet = new Set();
    for (const url of listUrls) {
      if (poolSet.size >= wantPools) break;
      try {
        const list = await (
          await fetch(url, { headers: { accept: "application/json" } })
        ).json();
        for (const p of list?.data || []) {
          const a = p?.attributes?.address;
          if (a) poolSet.add(a);
        }
      } catch {
        /* skip list */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const pools = [...poolSet].slice(0, wantPools);
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
        /* skip pool */
      }
      await new Promise((r) => setTimeout(r, 250)); // rate limit
    }
    console.log(`Active traders (GeckoTerminal): ${active.length}`);
  } catch (e) {
    console.warn("Active-trader source failed:", e.message);
  }
}

// 2) GMGN 7d PnL leaderboard (free; Cloudflare may block server-side).
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
        .slice(0, Number(process.env.GMGN_TRACK_LIMIT || 100))
        .map((r) => r.wallet_address || r.address)
        .filter(Boolean);
      console.log(`GMGN: ${gmgn.length}`);
    } else {
      console.warn(`GMGN failed (${res.status}) — Cloudflare likely. Skipping.`);
    }
  } catch (e) {
    console.warn("GMGN fetch failed:", e.message);
  }
}

// 3) Birdeye gainers/losers (best quality; needs a free key).
let birdeye = [];
if (process.env.BIRDEYE_API_KEY) {
  const want = Math.max(1, Number(process.env.BIRDEYE_TRACK_LIMIT || 200));
  const PAGE = 10;
  const pages = Math.min(Math.ceil(want / PAGE), 30);
  const seen = new Set();
  for (let i = 0; i < pages && birdeye.length < want; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1300));
    try {
      const res = await fetch(
        `https://public-api.birdeye.so/trader/gainers-losers?type=1W&sort_by=PnL&sort_type=desc&offset=${i * PAGE}&limit=${PAGE}`,
        { headers: { "X-API-KEY": process.env.BIRDEYE_API_KEY, "x-chain": "solana", accept: "application/json" } },
      );
      if (!res.ok) {
        console.warn(`Birdeye failed (${res.status}) at offset ${i * PAGE}`);
        break;
      }
      const json = await res.json();
      const items = json?.data?.items || json?.data || [];
      const page = (Array.isArray(items) ? items : [])
        .map((t) => t.address || t.owner || t.wallet)
        .filter(Boolean);
      for (const a of page) if (!seen.has(a)) (seen.add(a), birdeye.push(a));
      if (page.length < PAGE) break;
    } catch (e) {
      console.warn("Birdeye fetch failed:", e.message);
      break;
    }
  }
  console.log(`Birdeye: ${birdeye.length}`);
}

// Merge (manual wins on label/segment).
const map = new Map();
for (const a of active) if (a) map.set(a, { address: a, label: "Active", segment: "smart" });
for (const a of [...gmgn, ...birdeye]) if (a) map.set(a, { address: a, label: "Smart", segment: "smart" });
for (const w of manual) if (w?.address) map.set(w.address, w);
const tracked = [...map.values()];

if (tracked.length === 0) {
  console.error(
    "✗ No wallets sourced. Add BIRDEYE_API_KEY, or a manual list at " +
      `${walletsFile}: [{ "address": "...", "label": "Whale 1", "segment": "smart" }]`,
  );
  process.exit(1);
}

await mkdir("data", { recursive: true }).catch(() => {});
await writeFile("data/tracked-wallets.json", JSON.stringify(tracked, null, 2));
console.log(
  `\n✓ Wrote data/tracked-wallets.json — ${tracked.length} wallets ` +
    `(active ${active.length}, gmgn ${gmgn.length}, birdeye ${birdeye.length}, manual ${manual.length}).`,
);
console.log(
  "Restart so the workers pick up the set:  pm2 restart apewise apewise-rpc",
);
