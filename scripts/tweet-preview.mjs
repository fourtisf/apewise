#!/usr/bin/env node
/**
 * Preview the auto-tweet COPY without posting. Builds Moby-style tweets from
 * sample whale buys using the same formatting + conviction logic as the app,
 * and shows — for each — the exact text, char count, and whether it would clear
 * your current gate (TWEET_MIN_WIN_RATE / TWEET_MIN_CONVICTION).
 *
 * Runs on any Node 18+ (loads .env.local itself so it reflects your config):
 *   node scripts/tweet-preview.mjs
 *
 * The canonical logic lives in src/lib/server/tweetGate.ts — this mirrors it so
 * you can preview on a server whose Node can't strip TypeScript.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  let txt = "";
  try {
    txt = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();

const num = (n, d) => {
  const r = process.env[n];
  if (r == null || r === "") return d;
  const v = Number(r);
  return Number.isFinite(v) ? v : d;
};
const bool = (n, d) => {
  const r = process.env[n];
  if (r == null || r === "") return d;
  return r === "true";
};

// Mirror of STYLE_MAP in src/lib/server/tweetGate.ts.
const STYLE_MAP = {
  classic: (p) =>
    `🐳 A ${p.whaleTag} just bought ${p.amount} of ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") + (p.wr ? ` · ${p.wr}% win-rate wallet` : ""),
  alert: (p) =>
    `🚨 Smart-money buy — ${p.amount} into ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") + (p.wr ? ` from a ${p.wr}% win-rate wallet` : ""),
  punchy: (p) =>
    `👀 A ${p.wr ? `${p.wr}% win-rate ` : ""}whale just aped ${p.amount} into ${p.tok}` +
    (p.mc ? ` (${p.mc} MC)` : ""),
  conviction: (p) =>
    `💎 High-conviction buy: ${p.amount} of ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") + (p.wr ? ` · ${p.wr}% win-rate wallet` : ""),
  flow: (p) =>
    `📊 Smart-money inflow → ${p.tok}: ${p.amount}` +
    (p.mc ? ` at ${p.mc} MC` : "") + (p.wr ? `. Wallet win-rate ${p.wr}%` : ""),
  fomo: (p) =>
    `🔥 Whales are loading ${p.tok} — ${p.amount} buy` +
    (p.mc ? ` at ${p.mc} MC` : "") + (p.wr ? ` from a ${p.wr}% win-rate wallet` : ""),
  minimal: (p) =>
    `🐳 ${p.amount} → ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") + (p.wr ? ` · ${p.wr}% WR` : ""),
};
const STYLE_KEYS = Object.keys(STYLE_MAP);

function parseStyles() {
  const list = (process.env.TWEET_STYLES ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter((k) => STYLE_MAP[k]);
  return list.length ? list : [...STYLE_KEYS];
}

const cfg = {
  minWinRate: num("TWEET_MIN_WIN_RATE", 80),
  minConviction: num("TWEET_MIN_CONVICTION", 70),
  minUsd: num("TWEET_MIN_USD", 10000),
  styles: parseStyles(),
  whaleTag: process.env.TWEET_WHALE_TAG || "smart-money whale",
  showWinRate: bool("TWEET_SHOW_WINRATE", true),
  includeChartLink: bool("TWEET_INCLUDE_CHART_LINK", false),
  suffix: process.env.TWEET_SUFFIX || "",
};

// ── copy (mirror of tweetGate.ts) ──
function fmtUsdTweet(n) {
  if (n == null || !Number.isFinite(n)) return "";
  const a = Math.abs(n);
  const unit = (v, s) => `$${v.toFixed(2).replace(/\.?0+$/, "")}${s}`;
  if (a >= 1e12) return unit(n / 1e12, "T");
  if (a >= 1e9) return unit(n / 1e9, "B");
  if (a >= 1e6) return unit(n / 1e6, "M");
  if (a >= 1e3) return unit(n / 1e3, "K");
  return `$${Math.round(n)}`;
}
function cashtag(sym) {
  const s = (sym || "").replace(/^\$+/, "").trim();
  return /^[A-Za-z][A-Za-z0-9]{0,29}$/.test(s) ? `$${s}` : s || "token";
}
function buildTweet(ev, styleKey) {
  const amount = fmtUsdTweet(ev.amountUsd);
  const tok = cashtag(ev.token);
  const mc = ev.marketCapUsd != null ? fmtUsdTweet(ev.marketCapUsd) : "";
  const wr = cfg.showWinRate && ev.observed && ev.winRate > 0 ? ev.winRate : null;
  const key = STYLE_MAP[styleKey] ? styleKey : cfg.styles[0] || "classic";
  let out = STYLE_MAP[key]({ whaleTag: cfg.whaleTag, amount, tok, mc, wr });
  if (cfg.includeChartLink && ev.tokenMint) {
    const link = ` 📊 dexscreener.com/solana/${ev.tokenMint}`;
    if (out.length + link.length <= 280) out += link;
  }
  if (cfg.suffix) {
    const suf = ` ${cfg.suffix}`;
    if (out.length + suf.length <= 280) out += suf;
  }
  if (out.length > 280) out = out.slice(0, 279) + "…";
  return out;
}
const clamp = (x) => Math.max(0, Math.min(100, x));
function conviction(ev) {
  const wr = ev.observed ? ev.winRate : cfg.minWinRate;
  const winC = clamp(wr);
  const sizeC = clamp(((Math.log10(Math.max(ev.amountUsd, 1)) - 3) / 3) * 100);
  const liqC = clamp(((Math.log10(Math.max(ev.liquidityUsd ?? 0, 1)) - 3.3) / 2.7) * 100);
  const pnl = ev.pnlUsd ?? 0;
  const pnlC = pnl > 0 ? clamp(((Math.log10(pnl) - 3) / 3) * 100) : 0;
  return Math.round(0.45 * winC + 0.3 * sizeC + 0.15 * liqC + 0.1 * pnlC);
}

// ── sample whale buys (varied) ──
const samples = [
  { token: "WIF", amountUsd: 120000, marketCapUsd: 1_200_000_000, liquidityUsd: 900000, winRate: 91, pnlUsd: 1_400_000, observed: true },
  { token: "POPCAT", amountUsd: 75000, marketCapUsd: 340_000_000, liquidityUsd: 500000, winRate: 88, pnlUsd: 620000, observed: true },
  { token: "PEPE", amountUsd: 52000, marketCapUsd: 8_400_000, liquidityUsd: 210000, winRate: 84, pnlUsd: 180000, observed: true },
  { token: "BONK", amountUsd: 210000, marketCapUsd: 2_100_000_000, liquidityUsd: 1_500_000, winRate: 93, pnlUsd: 3_100_000, observed: true },
  { token: "mSOL", amountUsd: 34000, marketCapUsd: 187_730_000, liquidityUsd: 400000, winRate: 82, pnlUsd: 260000, observed: true },
  { token: "Fartcoin", amountUsd: 12000, marketCapUsd: 146_860_000, liquidityUsd: 300000, winRate: 80, pnlUsd: 90000, observed: true },
];

// ── A) semua gaya copy (rotasi otomatis tiap tweet) ──
const demo = samples[3]; // $210K BONK, 93% WR
console.log(`\n=== ${STYLE_KEYS.length} GAYA COPY (dirotasi otomatis tiap tweet) ===`);
console.log(`aktif: ${cfg.styles.join(", ")}\n`);
for (const key of STYLE_KEYS) {
  const on = cfg.styles.includes(key) ? "●" : "○";
  const text = buildTweet(demo, key);
  console.log(`${on} ${key.padEnd(11)} (${String(text.length).padStart(3)} chars)`);
  console.log(`   ${text}\n`);
}

// ── B) uji gate: mana yang lolos, pakai gaya yang dirotasi ──
console.log(
  `=== GATE:  WR ≥ ${cfg.minWinRate}%  ·  conviction ≥ ${cfg.minConviction}  ·  min buy ${fmtUsdTweet(cfg.minUsd)} ===\n`,
);
let rot = 0;
for (const s of samples) {
  const conv = conviction(s);
  const wrOk = s.winRate >= cfg.minWinRate;
  const sizeOk = s.amountUsd >= cfg.minUsd;
  const pass = wrOk && sizeOk && conv >= cfg.minConviction;
  const mark = pass ? "✅ TWEET" : "❌ SKIP ";
  const why = pass
    ? ""
    : "  ← " +
      [
        !wrOk ? `WR ${s.winRate}%<${cfg.minWinRate}` : null,
        !sizeOk ? `buy<${fmtUsdTweet(cfg.minUsd)}` : null,
        conv < cfg.minConviction ? `conv ${conv}<${cfg.minConviction}` : null,
      ]
        .filter(Boolean)
        .join(", ");
  // pakai gaya yang dirotasi, seperti di produksi (hanya untuk yang lolos)
  const styleKey = cfg.styles[rot % cfg.styles.length];
  if (pass) rot++;
  const text = buildTweet(s, styleKey);
  console.log(`${mark} [conv ${String(conv).padStart(2)}] (${String(text.length).padStart(3)} chars)${why}`);
  console.log(`   ${text}\n`);
}
console.log(
  "Yang ✅ = bakal di-tweet. Atur di .env.local:\n" +
    "  TWEET_STYLES=classic,alert,punchy,...   (pilih gaya yg dipakai; default semua)\n" +
    "  TWEET_MIN_WIN_RATE / TWEET_MIN_CONVICTION / TWEET_MIN_USD   (ketatnya)\n" +
    "Force-post satu ke X:  node scripts/tweet-test.mjs '<tempel salah satu baris tweet>'\n",
);
