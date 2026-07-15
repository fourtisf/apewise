#!/usr/bin/env node
/**
 * ApeWise doctor — one command that answers "why did the bot go quiet?".
 * Run it ON THE SERVER from the app directory:
 *
 *   node scripts/doctor.mjs             # full diagnosis
 *   node scripts/doctor.mjs --send-test # also post a test message to the channel
 *
 * It checks, end to end, every link in the posting chain:
 *   env config → wallet files → ingest mode (Helius webhook state / RPC
 *   reachability) → data freshness (events/tweets) → Telegram bot + channel
 *   permissions → X credentials → the running app's /api/health verdict —
 * and prints a PASS/WARN/FAIL line per check with the concrete fix command.
 * Read-only except --send-test. Exit code 1 when any FAIL was found.
 */
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { loadEnv } from "./lib/env.mjs";

// Load .env.local then .env (plain node doesn't read them — Next does).
await loadEnv();

const SEND_TEST = process.argv.includes("--send-test");
const env = (k) => process.env[k] || "";
const results = []; // { level: "PASS"|"WARN"|"FAIL", area, msg, fix? }
const pass = (area, msg) => results.push({ level: "PASS", area, msg });
const warn = (area, msg, fix) => results.push({ level: "WARN", area, msg, fix });
const fail = (area, msg, fix) => results.push({ level: "FAIL", area, msg, fix });

const fmtAgo = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 2880) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

async function jfetch(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, ok: res.ok, json, text };
  } catch (e) {
    return { status: 0, ok: false, json: null, text: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function lastJsonlTs(file) {
  try {
    const txt = await readFile(file, "utf8");
    const lines = txt.trim().split("\n").filter(Boolean);
    if (!lines.length) return null;
    const last = JSON.parse(lines[lines.length - 1]);
    return { ts: last.ts, count: lines.length };
  } catch {
    return null;
  }
}

console.log("🩺 ApeWise doctor\n");

// ─────────────────────────────── 1. wallets ───────────────────────────────
const manualFile = env("SMART_WALLETS_FILE") || "data/smart-wallets.json";
const manual = (await readJsonFile(manualFile)) || [];
const tracked = (await readJsonFile(env("TRACKED_WALLETS_FILE") || "data/tracked-wallets.json")) || [];
const walletCount = new Set(
  [...manual, ...tracked].map((w) => w?.address).filter(Boolean),
).size;
if (walletCount === 0) {
  fail(
    "wallets",
    "0 tracked wallets on disk — nothing can be detected, BOTH channels stay silent",
    "node scripts/source-wallets.mjs   (needs SOLANATRACKER_API_KEY or BIRDEYE_API_KEY), or create data/smart-wallets.json manually",
  );
} else {
  pass("wallets", `${walletCount} wallets on disk (manual ${manual.length}, tracked ${tracked.length})`);
}

// ─────────────────────────────── 2. ingest mode ───────────────────────────────
const heliusKey = env("HELIUS_API_KEY");
const webhookUrl = env("WEBHOOK_URL");
let webhookAddrs = null;
if (heliusKey) {
  const r = await jfetch(`https://api.helius.xyz/v0/webhooks?api-key=${heliusKey}`);
  if (!r.ok) {
    fail(
      "helius",
      `webhook list failed (HTTP ${r.status}) — key invalid/expired? ${String(r.text).slice(0, 120)}`,
      "check HELIUS_API_KEY at dashboard.helius.dev, then re-run: node scripts/setup-helius-webhook.mjs",
    );
  } else {
    const hooks = Array.isArray(r.json) ? r.json : [];
    const mine = hooks.filter((w) => w.webhookURL === webhookUrl);
    if (!webhookUrl) {
      warn("helius", "HELIUS_API_KEY set but WEBHOOK_URL empty — can't verify webhook target", "set WEBHOOK_URL in .env");
    } else if (mine.length === 0) {
      fail(
        "helius",
        `NO webhook registered for ${webhookUrl} (found ${hooks.length} other webhook(s)) — Helius is not delivering swaps`,
        "node scripts/setup-helius-webhook.mjs",
      );
    } else {
      const wh = mine[0];
      webhookAddrs = new Set(wh.accountAddresses || []);
      pass("helius", `webhook ${wh.webhookID} → ${webhookUrl} (${webhookAddrs.size} addresses)`);
      if (mine.length > 1)
        warn("helius", `${mine.length} webhooks point at the same URL — double delivery`, "node scripts/setup-helius-webhook.mjs (it de-dupes)");
      const ingestSecret = env("INGEST_SECRET");
      if (ingestSecret && wh.authHeader !== undefined && wh.authHeader !== ingestSecret) {
        fail(
          "helius",
          "webhook authHeader ≠ INGEST_SECRET — every delivery is rejected 401 at /api/ingest/helius",
          "node scripts/setup-helius-webhook.mjs   (re-registers with the current secret)",
        );
      }
      // The classic silent killer: source-wallets.mjs rewrote the tracked file
      // but the webhook still watches the OLD address list.
      const disk = new Set([...manual, ...tracked].map((w) => w?.address).filter(Boolean));
      let overlap = 0;
      for (const a of disk) if (webhookAddrs.has(a)) overlap++;
      if (disk.size && overlap === 0) {
        fail(
          "helius",
          "webhook address list has ZERO overlap with the wallets on disk — deliveries are filtered out (parsed=0) and nothing posts",
          "node scripts/setup-helius-webhook.mjs   (sync the webhook to the current wallet set)",
        );
      } else if (disk.size && overlap < disk.size / 2) {
        warn(
          "helius",
          `webhook only covers ${overlap}/${disk.size} of the wallets on disk — most tracked wallets are invisible`,
          "node scripts/setup-helius-webhook.mjs",
        );
      }
    }
  }
} else {
  console.log("(no HELIUS_API_KEY — assuming RPC-poll mode)");
}

// RPC reachability (matters in RPC-poll mode; cheap to check always)
const rpcUrls = (env("SOLANA_RPC_URLS") || env("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
for (const rpcUrl of rpcUrls) {
  const r = await jfetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth", params: [] }),
  });
  if (r.ok && r.json?.result === "ok") pass("rpc", `${rpcUrl} healthy`);
  else if (r.status === 429)
    fail("rpc", `${rpcUrl} is RATE-LIMITING this IP (429) — poll ingestion returns nothing`, "set SOLANA_RPC_URLS to add fallback endpoints (e.g. a free Helius/Triton/Ankr RPC)");
  else warn("rpc", `${rpcUrl} unhealthy (HTTP ${r.status}) ${String(r.text).slice(0, 80)}`, "set SOLANA_RPC_URLS with a working endpoint");
}

// ─────────────────────────────── 3. data freshness ───────────────────────────────
const events = await lastJsonlTs(env("EVENTS_FILE") || "data/events.jsonl");
if (!events) {
  warn("data", "data/events.jsonl missing/empty — no swap has EVER been ingested on this box", "check ingest mode above; run the debug probe: curl 'localhost:3000/api/ingest/rpc-poll?debug=<wallet>&secret=$INGEST_SECRET'");
} else {
  const age = Date.now() - events.ts;
  if (age > 24 * 3600_000)
    fail("data", `last ingested event is ${fmtAgo(age)} (${events.count} total) — ingestion is DEAD, so Telegram AND X are silent`, "fix the ingest mode above (webhook sync / RPC throttling / wallet set)");
  else if (age > 6 * 3600_000)
    warn("data", `last ingested event is ${fmtAgo(age)} — ingestion may be dying`, "watch pm2 logs apewise --lines 100");
  else pass("data", `last event ${fmtAgo(age)} (${events.count} in file)`);
}
const tweets = await lastJsonlTs(env("TWEETS_FILE") || "data/tweets.jsonl");
if (tweets) pass("data", `last recorded tweet ${fmtAgo(Date.now() - tweets.ts)} (${tweets.count} in file)`);
else warn("data", "data/tweets.jsonl missing/empty — the X channel has never posted from this box");

// ─────────────────────────────── 4. Telegram ───────────────────────────────
const tgToken = env("TELEGRAM_BOT_TOKEN");
const tgChat = env("TELEGRAM_SIGNALS_CHAT_ID");
if (!tgToken) fail("telegram", "TELEGRAM_BOT_TOKEN empty — every channel post is a dry-run log", "set it in .env and pm2 restart apewise --update-env");
else {
  const me = await jfetch(`https://api.telegram.org/bot${tgToken}/getMe`);
  if (!me.ok || !me.json?.ok)
    fail("telegram", `getMe failed (HTTP ${me.status}) — token revoked/invalid`, "get a fresh token from @BotFather, update .env, pm2 restart apewise --update-env");
  else {
    const bot = me.json.result;
    pass("telegram", `bot @${bot.username} token valid`);
    if (!tgChat) fail("telegram", "TELEGRAM_SIGNALS_CHAT_ID empty — nowhere to post", "set it (e.g. @apewisesignals)");
    else {
      const member = await jfetch(
        `https://api.telegram.org/bot${tgToken}/getChatMember?chat_id=${encodeURIComponent(tgChat)}&user_id=${bot.id}`,
      );
      if (!member.ok || !member.json?.ok) {
        fail(
          "telegram",
          `getChatMember(${tgChat}) failed: ${member.json?.description || member.status} — wrong chat id or bot not in the channel`,
          "add the bot to the channel as admin with 'Post messages' right",
        );
      } else {
        const m = member.json.result;
        const canPost = m.status === "creator" || (m.status === "administrator" && m.can_post_messages !== false);
        if (canPost) pass("telegram", `bot is ${m.status} of ${tgChat} and can post`);
        else fail("telegram", `bot is '${m.status}' of ${tgChat} and CANNOT post — this alone silences the TG channel`, "promote the bot to admin with 'Post messages'");
      }
      if (SEND_TEST) {
        const sent = await jfetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: tgChat, text: "🩺 ApeWise doctor: test post OK" }),
        });
        if (sent.json?.ok) pass("telegram", "test message posted to the channel");
        else fail("telegram", `test post failed: ${sent.json?.description || sent.status}`);
      }
    }
  }
}

// ─────────────────────────────── 5. X / Twitter ───────────────────────────────
const xk = env("TWITTER_API_KEY"), xs = env("TWITTER_API_SECRET");
const xt = env("TWITTER_ACCESS_TOKEN"), xts = env("TWITTER_ACCESS_SECRET");
if (!xk || !xs || !xt || !xts) {
  warn("x", "X keys not fully set — tweet channel is in dry-run (composes but never posts)", "set all four TWITTER_* vars for live posting");
} else {
  // OAuth 1.0a-signed GET /2/users/me — proves the 4 keys are alive.
  const pct = (v) => encodeURIComponent(v).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const url = "https://api.twitter.com/2/users/me";
  const oauth = {
    oauth_consumer_key: xk,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: xt,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(oauth).sort().map((k) => `${pct(k)}=${pct(oauth[k])}`).join("&");
  const base = ["GET", pct(url), pct(paramString)].join("&");
  const sig = crypto.createHmac("sha1", `${pct(xs)}&${pct(xts)}`).update(base).digest("base64");
  const header = "OAuth " + Object.keys({ ...oauth, oauth_signature: sig }).sort()
    .map((k) => `${pct(k)}="${pct({ ...oauth, oauth_signature: sig }[k])}"`).join(", ");
  const r = await jfetch(url, { headers: { Authorization: header } });
  if (r.ok) pass("x", `credentials valid (@${r.json?.data?.username || "?"})`);
  else if (r.status === 401 || r.status === 403)
    fail("x", `X auth REJECTED (HTTP ${r.status}): ${String(r.text).slice(0, 140)} — keys revoked, app suspended, or tokens predate Read+Write`, "developer.x.com → app → set Read and Write → REGENERATE Access Token & Secret → update .env → pm2 restart apewise --update-env");
  else if (r.status === 429 && /usage.?cap/i.test(r.text))
    fail("x", "X MONTHLY USAGE CAP exhausted — no tweet will post until the cap resets", "upgrade the API tier, or lower volume (disable TWEET_MOBY_MODE / lower TWEET_MAX_PER_DAY)");
  else if (r.status === 429) warn("x", "X rate-limited the check (429) — transient; try again in 15 min");
  else warn("x", `unexpected X response HTTP ${r.status}: ${String(r.text).slice(0, 120)}`);
}

// ─────────────────────────────── 6. running app ───────────────────────────────
const port = env("PORT") || 3000;
const secret = env("INGEST_SECRET");
const h = await jfetch(`http://localhost:${port}/api/health${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`, {}, 5000);
if (h.status === 0) {
  fail("app", `Next app unreachable on localhost:${port} — NOTHING posts while it's down`, "pm2 restart apewise && pm2 logs apewise");
} else if (h.status === 404) {
  warn("app", "app is up but /api/health is 404 — running an old build", "./deploy.sh  (pull + rebuild + reload)");
} else if (h.json) {
  const v = h.json;
  if (v.status === "ok") pass("app", "pipeline health: ok");
  else (v.status === "stalled" ? fail : warn)("app", `pipeline health: ${v.status} — ${(v.problems || []).join(" | ")}`, "see problems above; pm2 logs apewise apewise-tweets apewise-rpc");
  const tg = v.health?.telegram, tw = v.health?.twitter, di = v.health?.tweetDispatch;
  if (tg) console.log(`   ↳ telegram: ok=${tg.ok} fail=${tg.fail} streak=${tg.failStreak}${tg.lastError ? ` lastErr="${tg.lastError}"` : ""}`);
  if (tw) console.log(`   ↳ twitter:  ok=${tw.ok} fail=${tw.fail} streak=${tw.failStreak}${tw.authFailed ? " AUTH-FAILED" : ""}${tw.capped ? " USAGE-CAPPED" : ""}${tw.lastError ? ` lastErr="${tw.lastError}"` : ""}`);
  if (di) console.log(`   ↳ dispatch: pool=${di.poolSize ?? "?"} lastBlocked=${di.lastBlocked ?? "-"} lastPosted=${di.lastPostedAt ? fmtAgo(Date.now() - di.lastPostedAt) : "never"}`);
}

// ─────────────────────────────── report ───────────────────────────────
console.log("");
const icon = { PASS: "✅", WARN: "⚠️ ", FAIL: "❌" };
for (const r of results) {
  console.log(`${icon[r.level]} [${r.area}] ${r.msg}`);
  if (r.fix) console.log(`      fix → ${r.fix}`);
}
const fails = results.filter((r) => r.level === "FAIL").length;
const warns = results.filter((r) => r.level === "WARN").length;
console.log(`\n${fails} FAIL · ${warns} WARN · ${results.length - fails - warns} PASS`);
if (fails) {
  console.log("Fix the ❌ items top-to-bottom — the first one is usually THE reason the bot went quiet.");
  process.exit(1);
}
console.log("No hard failures. If the channels are still quiet, the gates may just be strict — try: pm2 logs apewise-tweets and look for '[tweet] paced/skipped' reasons.");
