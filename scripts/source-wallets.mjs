#!/usr/bin/env node
/**
 * Source a smart-money wallet set WITHOUT Helius, and persist it to
 * data/tracked-wallets.json (which the app's walletMap reads — see
 * lib/server/wallets.ts). The RPC poll worker (scripts/rpc-poll-worker.mjs)
 * then polls exactly these wallets over a free public RPC — no webhook, no
 * Helius credit cap.
 *
 *   node scripts/source-wallets.mjs
 *
 * Sources (all fail-soft — a dead source never aborts the run):
 *   1. Solana Tracker top traders by WIN RATE — best "high win-rate" signal.
 *      Free key (data.solanatracker.io). Needs SOLANATRACKER_API_KEY.
 *   2. Birdeye top traders by PnL — high quality, no Cloudflare.
 *      Needs BIRDEYE_API_KEY. Runs several timeframes and de-dupes.
 *   3. GeckoTerminal active traders — keyless baseline. FREE TIER IS 30 req/min,
 *      so every call is serialized at ~2.2s; a run takes ~1 min.
 *   4. GMGN 7d leaderboard — Cloudflare-blocks datacenter IPs (403); kept as a
 *      best-effort only and off by default (USE_GMGN_WALLETS=true to try).
 * Manual picks in data/smart-wallets.json always win on label/segment.
 *
 * Tunables (env or .env.local — this script loads .env.local itself):
 *   SOLANATRACKER_API_KEY, SOLANATRACKER_LIMIT (150), SOLANATRACKER_MIN_WINRATE
 *   (55), SOLANATRACKER_MIN_TRADES (20)
 *   BIRDEYE_API_KEY, BIRDEYE_TRACK_LIMIT (200), BIRDEYE_TIMEFRAMES (1W,today,yesterday)
 *   ACTIVE_MIN_USD (1000), ACTIVE_POOLS (20), GECKO_DELAY_MS (2200)
 *   USE_GMGN_WALLETS (false), GMGN_TRACK_LIMIT (100)
 * The RPC poller covers a large set via a rotating window (RPC_MAX_WALLETS per
 * cycle), so a few hundred tracked wallets is fine — bump the limits above.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

/**
 * Load .env.local into process.env (plain `node` doesn't read it — only Next
 * does). Without this, BIRDEYE_API_KEY / SOLANATRACKER_API_KEY live in
 * .env.local but are invisible here, so those sources silently no-op and we can
 * end up sourcing zero wallets. Existing env vars win, so an inline override
 * still takes effect.
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
    ) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(" #"); // strip an unquoted inline comment
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
await loadDotEnvLocal();

const walletsFile = process.env.SMART_WALLETS_FILE || "data/smart-wallets.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let manual = [];
try {
  manual = JSON.parse(await readFile(walletsFile, "utf8"));
} catch {
  /* no manual list — auto-source only */
}

// ── 1) Solana Tracker — top traders ranked by WIN RATE (best signal) ──────────
let stracker = [];
if (process.env.SOLANATRACKER_API_KEY) {
  const key = process.env.SOLANATRACKER_API_KEY;
  const want = Math.max(1, Number(process.env.SOLANATRACKER_LIMIT || 150));
  const minWr = Number(process.env.SOLANATRACKER_MIN_WINRATE || 55);
  const minTrades = Number(process.env.SOLANATRACKER_MIN_TRADES || 20);
  const seen = new Set();
  for (let page = 1; page <= 25 && stracker.length < want; page++) {
    if (page > 1) await sleep(1100); // free tier ~1 req/s
    let json;
    try {
      const res = await fetch(
        `https://data.solanatracker.io/top-traders/all?page=${page}&sortBy=winPercentage&expandPnl=true`,
        { headers: { "x-api-key": key, accept: "application/json" } },
      );
      if (!res.ok) {
        console.warn(`Solana Tracker failed (${res.status}) page ${page}`);
        break;
      }
      json = await res.json();
    } catch (e) {
      console.warn("Solana Tracker fetch failed:", e.message);
      break;
    }
    const rows = Array.isArray(json) ? json : json?.wallets || json?.data || [];
    if (!rows.length) break;
    for (const r of rows) {
      const w = r.wallet || r.address;
      const s = r.summary || r;
      const wr = Number(s.winPercentage ?? s.winRate ?? 0);
      const wins = Number(s.totalWins ?? 0);
      const losses = Number(s.totalLosses ?? 0);
      const trades = wins + losses || Number(s.totalTrades ?? s.total ?? 0);
      // Require a real win-rate AND enough trades so a lucky 1-2 trade "100%"
      // wallet doesn't slip in. Unknown trade count → trust the win-rate sort.
      if (w && wr >= minWr && (trades === 0 || trades >= minTrades) && !seen.has(w)) {
        seen.add(w);
        stracker.push(w);
      }
    }
    if (rows.length < 10) break; // likely the last page
  }
  console.log(`Solana Tracker (high win-rate): ${stracker.length}`);
}

// ── 2) Birdeye — top traders by PnL, across several timeframes ────────────────
let birdeye = [];
if (process.env.BIRDEYE_API_KEY) {
  const want = Math.max(1, Number(process.env.BIRDEYE_TRACK_LIMIT || 200));
  const PAGE = 10; // Birdeye caps limit at 10; paginate via offset
  const timeframes = (process.env.BIRDEYE_TIMEFRAMES || "1W,today,yesterday")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const maxPages = Math.min(Math.ceil(want / PAGE), 30);
  outer: for (const tf of timeframes) {
    let retries = 0; // bounded 429 retries per timeframe (can't spin)
    for (let i = 0; i < maxPages && birdeye.length < want; i++) {
      await sleep(1100); // free "Standard" tier ~1 req/s
      let res;
      try {
        res = await fetch(
          `https://public-api.birdeye.so/trader/gainers-losers?type=${encodeURIComponent(tf)}&sort_by=PnL&sort_type=desc&offset=${i * PAGE}&limit=${PAGE}`,
          {
            headers: {
              "X-API-KEY": process.env.BIRDEYE_API_KEY,
              "x-chain": "solana",
              accept: "application/json",
            },
          },
        );
      } catch (e) {
        console.warn("Birdeye fetch failed:", e.message);
        break;
      }
      if (res.status === 429) {
        if (++retries > 5) {
          console.warn("Birdeye 429 — giving up on this timeframe");
          break;
        }
        console.warn("Birdeye 429 — backing off 5s");
        await sleep(5000);
        i--; // retry same page (retries counter bounds the spin)
        continue;
      }
      if (!res.ok) {
        console.warn(`Birdeye failed (${res.status}) tf=${tf} offset ${i * PAGE}`);
        break;
      }
      const json = await res.json();
      const items = json?.data?.items || json?.data || [];
      const page = (Array.isArray(items) ? items : [])
        .map((t) => t.address || t.owner || t.wallet)
        .filter(Boolean);
      if (!page.length) break; // end of this timeframe's list
      for (const a of page) if (!seen.has(a)) (seen.add(a), birdeye.push(a));
      if (page.length < PAGE) break;
      if (birdeye.length >= want) break outer;
    }
  }
  console.log(`Birdeye (top PnL): ${birdeye.length}`);
}

// ── 2b) Birdeye — top traders OF trending tokens (SAME key, no extra signup) ──
// The gainers-losers board is a finite ~150. This harvests the winning wallets
// of each currently-trending token, so it adds many more high-quality wallets
// without any new account. Fail-soft: if these endpoints aren't on your plan it
// just logs 0 and the rest of the set is unaffected.
let bdtop = [];
if (
  process.env.BIRDEYE_API_KEY &&
  process.env.USE_BIRDEYE_TOPTRADERS !== "false"
) {
  const H = {
    "X-API-KEY": process.env.BIRDEYE_API_KEY,
    "x-chain": "solana",
    accept: "application/json",
  };
  const wantTokens = Math.max(1, Number(process.env.BIRDEYE_TREND_TOKENS || 25));
  const seen = new Set(birdeye); // don't recount wallets we already have
  // 1) trending token mints
  let mints = [];
  try {
    await sleep(1100);
    const res = await fetch(
      `https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=${wantTokens}`,
      { headers: H },
    );
    if (res.ok) {
      const json = await res.json();
      const toks =
        json?.data?.tokens || json?.data?.items || json?.data || [];
      mints = (Array.isArray(toks) ? toks : [])
        .map((t) => (typeof t === "string" ? t : t.address || t.mint))
        .filter((a) => typeof a === "string" && a.length > 20);
    } else {
      console.warn(`Birdeye trending failed (${res.status})`);
    }
  } catch (e) {
    console.warn("Birdeye trending fetch failed:", e.message);
  }
  // 2) top traders of each trending token → their winning wallets
  for (const mint of mints.slice(0, wantTokens)) {
    await sleep(1100);
    try {
      const res = await fetch(
        `https://public-api.birdeye.so/defi/v2/tokens/top_traders?address=${mint}&time_frame=24h&sort_by=volume&sort_type=desc&offset=0&limit=10`,
        { headers: H },
      );
      if (res.status === 429) {
        await sleep(4000);
        continue;
      }
      if (!res.ok) continue;
      const json = await res.json();
      const items = json?.data?.items || json?.data || [];
      for (const t of Array.isArray(items) ? items : []) {
        const w = t.owner || t.address || t.wallet;
        if (w && !seen.has(w)) {
          seen.add(w);
          bdtop.push(w);
        }
      }
    } catch {
      /* skip token */
    }
  }
  console.log(`Birdeye (token top-traders): ${bdtop.length} from ${mints.length} trending tokens`);
}

// ── 3) GeckoTerminal active traders — keyless bonus, OFF by default ───────────
// Free tier is 30 req/min per IP; datacenter/VPS IPs are frequently already
// throttled (constant 429s), and it's the lowest-quality source (active traders,
// not proven winners). Birdeye (gainers + trending-token top-traders) carries
// the load, so this is opt-in: set USE_ACTIVE_TRADERS=true to enable.
let active = [];
if (process.env.USE_ACTIVE_TRADERS === "true") {
  const minUsd = Math.round(Number(process.env.ACTIVE_MIN_USD || 1000));
  const wantPools = Math.max(1, Number(process.env.ACTIVE_POOLS || 20));
  const GAP = Math.max(2100, Number(process.env.GECKO_DELAY_MS || 2200));
  // Circuit breaker: bail the whole source after this many TOTAL 429s (not
  // consecutive — the list calls can succeed while the trades calls 429, which
  // used to keep resetting a "consecutive" counter so it never tripped).
  const GECKO_MAX_429 = Math.max(1, Number(process.env.GECKO_MAX_429 || 4));
  let total429 = 0;
  let throttled = false;
  let lastCall = 0;
  // Shared serial getter: enforces spacing + honors 429 (the free tier is a
  // hard 30 req/min per IP, so bursting is what returned 0 before).
  const geckoGet = async (url) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = GAP - (Date.now() - lastCall);
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      let res;
      try {
        res = await fetch(url, { headers: { accept: "application/json" } });
      } catch {
        return null;
      }
      if (res.status === 429) {
        if (++total429 >= GECKO_MAX_429) {
          throttled = true; // IP is rate-limited — stop hammering, bail the source
          console.warn(
            `GeckoTerminal: IP throttled (${total429}× 429) — skipping this source`,
          );
          return null;
        }
        const ra = Number(res.headers.get("retry-after")) || 5 * (attempt + 1);
        console.warn(`GeckoTerminal 429 — backing off ${ra}s`);
        await sleep(ra * 1000);
        continue;
      }
      if (!res.ok) {
        console.warn(`GeckoTerminal ${res.status} for ${url}`);
        return null;
      }
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    return null;
  };
  const base = "https://api.geckoterminal.com/api/v2/networks/solana";
  const listUrls = [
    `${base}/trending_pools?page=1`,
    `${base}/pools?page=1&sort=h24_volume_usd_desc`,
    `${base}/new_pools?page=1`,
  ];
  const poolSet = new Set();
  for (const url of listUrls) {
    if (throttled || poolSet.size >= wantPools) break;
    const list = await geckoGet(url);
    for (const p of list?.data || []) {
      const a = p?.attributes?.address;
      if (a) poolSet.add(a);
    }
  }
  const pools = [...poolSet].slice(0, wantPools);
  const seen = new Set();
  for (const addr of pools) {
    if (throttled) break;
    // Server-side volume floor (param) + keep buyers only (accumulation signal).
    const tr = await geckoGet(
      `${base}/pools/${addr}/trades?trade_volume_in_usd_greater_than=${minUsd}`,
    );
    for (const t of tr?.data || []) {
      const a = t?.attributes || {};
      if (a.kind && a.kind !== "buy") continue;
      const w = a.tx_from_address;
      if (w && !seen.has(w)) {
        seen.add(w);
        active.push(w);
      }
    }
  }
  console.log(`Active traders (GeckoTerminal): ${active.length} from ${pools.length} pools`);
}

// ── 4) GMGN 7d leaderboard — Cloudflare-blocks datacenter IPs; off by default ──
let gmgn = [];
if (process.env.USE_GMGN_WALLETS === "true") {
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
      console.warn(`GMGN failed (${res.status}) — Cloudflare blocks datacenter IPs. Skipping.`);
    }
  } catch (e) {
    console.warn("GMGN fetch failed:", e.message);
  }
}

// ── Merge (best signal wins the label; manual always wins) ────────────────────
const map = new Map();
for (const a of active) if (a) map.set(a, { address: a, label: "Active", segment: "smart" });
for (const a of gmgn) if (a) map.set(a, { address: a, label: "Smart", segment: "smart" });
for (const a of bdtop) if (a) map.set(a, { address: a, label: "TopTrader", segment: "smart" });
for (const a of birdeye) if (a) map.set(a, { address: a, label: "TopPnL", segment: "smart" });
for (const a of stracker) if (a) map.set(a, { address: a, label: "HighWR", segment: "smart" });
for (const w of manual) if (w?.address) map.set(w.address, w);
const tracked = [...map.values()];

if (tracked.length === 0) {
  console.error(
    "✗ No wallets sourced. Set SOLANATRACKER_API_KEY or BIRDEYE_API_KEY in " +
      ".env.local (GeckoTerminal alone can be thin), or add a manual list at " +
      `${walletsFile}: [{ "address": "...", "label": "Whale 1", "segment": "smart" }]`,
  );
  process.exit(1);
}

await mkdir("data", { recursive: true }).catch(() => {});
await writeFile("data/tracked-wallets.json", JSON.stringify(tracked, null, 2));
console.log(
  `\n✓ Wrote data/tracked-wallets.json — ${tracked.length} wallets ` +
    `(winrate ${stracker.length}, pnl ${birdeye.length}, toptrader ${bdtop.length}, active ${active.length}, gmgn ${gmgn.length}, manual ${manual.length}).`,
);
console.log(
  "Restart so the workers pick up the set:  pm2 restart apewise apewise-rpc",
);
