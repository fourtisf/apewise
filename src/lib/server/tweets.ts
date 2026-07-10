import { promises as fs } from "fs";
import path from "path";
import type { SmartEvent } from "./store";
import type { WalletQuality } from "./walletQuality";
import { walletQualityMap } from "./walletQuality";
import { postTweet, twitterConfigured } from "./twitter";
import { postToChannel, socialLinks } from "./alerts";
import {
  loadConfig,
  buildTweet,
  fmtUsdTweet,
  cashtag,
  hardGate,
  convictionScore,
  globalRateGate,
  noveltyBlocked,
  type PostedTweet,
  type TweetConfig,
} from "./tweetGate";

/**
 * Auto-tweet channel — "Whale Watch by Moby"-style posts, but deliberately
 * QUIET. Over-tweeting tanks reach (the X algorithm penalizes spammy, low-signal
 * accounts), so this is built to under-post: it only ever emits the single
 * highest-conviction buy per dispatch tick, and only from proven high-win-rate
 * smart-money wallets that clear every gate in `tweetGate.ts`.
 *
 * Detection (`enqueueForTweet`) and posting (`dispatchTweets`) are decoupled:
 * the webhook path just drops qualifying buys into an in-memory pool; a paced
 * worker drains it, re-checks the gate + global rate limits, and posts at most
 * one. That separation is what makes the pacing airtight — bursty on-chain
 * activity can never translate into bursty tweets.
 */

// ─────────────────────── rate-limit state (persisted) ───────────────────────

const TWEETS_FILE =
  process.env.TWEETS_FILE || path.join(process.cwd(), "data", "tweets.jsonl");
const KEEP = 500; // enough to cover any rolling window; keeps memory tiny

let posted: PostedTweet[] = [];
let postedIds = new Set<string>();
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const txt = await fs.readFile(TWEETS_FILE, "utf8");
    posted = txt
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-KEEP)
      .map((l) => JSON.parse(l) as PostedTweet);
    postedIds = new Set(posted.map((p) => p.eventId));
  } catch {
    /* no file yet */
  }
}

async function record(p: PostedTweet): Promise<void> {
  posted.push(p);
  if (posted.length > KEEP) posted = posted.slice(-KEEP);
  postedIds.add(p.eventId);
  try {
    await fs.mkdir(path.dirname(TWEETS_FILE), { recursive: true });
    await fs.appendFile(TWEETS_FILE, JSON.stringify(p) + "\n", "utf8");
  } catch (e) {
    console.error("[tweet] persist failed:", e);
  }
}

// ─────────────────────────── candidate pool ───────────────────────────

const pool = new Map<string, { ev: SmartEvent; at: number }>();
const POOL_MAX = 300;

/**
 * Cheap structural pre-filter → pool. The full gate (async wallet quality,
 * rate limits) runs at dispatch. Returns how many were queued.
 */
export function enqueueForTweet(events: SmartEvent[]): number {
  const cfg = loadConfig();
  let queued = 0;
  for (const ev of events) {
    if (ev.action !== "buy") continue;
    if (!ev.tokenMint) continue;
    if (!(ev.amountUsd >= cfg.minUsd)) continue;
    if (postedIds.has(ev.id) || pool.has(ev.id)) continue;
    pool.set(ev.id, { ev, at: Date.now() });
    queued++;
  }
  // Evict oldest if the pool grows unexpectedly large.
  if (pool.size > POOL_MAX) {
    const entries = [...pool.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < pool.size - POOL_MAX; i++) pool.delete(entries[i][0]);
  }
  return queued;
}

/** Test/introspection helper. */
export function _poolSize(): number {
  return pool.size;
}

// ─────────────────────────── dispatcher ───────────────────────────

export interface DispatchResult {
  posted: number;
  considered: number;
  blocked?: string;
}

// Guards against overlapping ticks (setInterval fire-and-forget + any concurrent
// request) both clearing the rate gate and posting before either records.
let dispatching = false;

// Round-robin over the enabled copy styles so consecutive tweets read varied.
let styleCounter = 0;
function nextStyle(cfg: TweetConfig): string {
  const list = cfg.styles && cfg.styles.length ? cfg.styles : ["classic"];
  return list[styleCounter++ % list.length];
}

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fmtAgeShort(min?: number): string | null {
  if (min == null) return null;
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  const d = min / 1440;
  return d < 365 ? `${Math.round(d)}d` : `${(d / 365).toFixed(1)}y`;
}

/**
 * Degen-professional Telegram post for a premium pick: hype header + scannable
 * metrics + edge (win-rate) + safety (anti-rug) + chart/socials. The raw
 * conviction score is hidden (only a "high conviction" badge when it's actually
 * high) so a weak number never undercuts the signal.
 */
async function mirrorToTelegram(
  ev: SmartEvent,
  quality: WalletQuality | undefined,
  conv: number,
): Promise<void> {
  const amount = fmtUsdTweet(ev.amountUsd);
  const tok = escHtml(cashtag(ev.token));
  const metrics = [
    ev.marketCapUsd != null ? `💰 MC ${fmtUsdTweet(ev.marketCapUsd)}` : null,
    ev.liquidityUsd != null ? `💧 Liq ${fmtUsdTweet(ev.liquidityUsd)}` : null,
    fmtAgeShort(ev.tokenAgeMin) ? `🕐 ${fmtAgeShort(ev.tokenAgeMin)}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const header =
    conv >= 70
      ? "🔥 <b>SMART-MONEY BUY</b>  ·  ⚡️ High conviction"
      : "🔥 <b>SMART-MONEY BUY</b>";
  const lines = [
    header,
    "",
    `🐳 A whale just aped <b>${amount}</b> into <b>${tok}</b>`,
    metrics || null,
    quality?.observed && quality.winRate > 0
      ? `🎯 <b>${quality.winRate}%</b> win-rate wallet`
      : null,
    ev.risk?.verdict === "ok" ? "🛡 Anti-rug: passed" : null,
    "",
    socialLinks(ev.tokenMint, ev.socials),
    ev.tokenMint ? `<code>${ev.tokenMint}</code>` : null,
  ].filter((l) => l !== null) as string[];
  await postToChannel(lines.join("\n"));
}

/**
 * Drain the pool, enforce the global rate gate, and post at most ONE tweet —
 * the highest-conviction candidate that clears every gate. Called on an interval
 * by the tweet worker / a cron. Never throws; serialized by an in-flight guard.
 */
export async function dispatchTweets(): Promise<DispatchResult> {
  if (dispatching) return { posted: 0, considered: pool.size, blocked: "in-flight" };
  dispatching = true;
  try {
    return await runDispatch();
  } finally {
    dispatching = false;
  }
}

async function runDispatch(): Promise<DispatchResult> {
  await ensureLoaded();
  const cfg = loadConfig();
  const now = Date.now();

  // Drop stale candidates + anything already posted (e.g. re-delivered after a
  // restart loaded the history).
  const ttl = cfg.candidateTtlMin * 60_000;
  for (const [id, c] of pool)
    if (now - c.at > ttl || postedIds.has(id)) pool.delete(id);
  if (pool.size === 0) return { posted: 0, considered: 0 };

  // Global pacing — if we're inside any window cap, post nothing this tick.
  const gate = globalRateGate(posted, now, cfg);
  if (!gate.ok) {
    console.log(`[tweet] paced (${gate.reason}); pool=${pool.size}`);
    return { posted: 0, considered: pool.size, blocked: gate.reason };
  }

  const qmap = await walletQualityMap();
  const ranked: { ev: SmartEvent; q?: WalletQuality; conv: number }[] = [];
  for (const { ev } of pool.values()) {
    if (postedIds.has(ev.id)) continue; // never tweet the same event twice
    const q = qmap.get(ev.wallet);
    if (!hardGate(ev, q, cfg).ok) continue;
    if (noveltyBlocked(posted, ev, now, cfg)) continue;
    const conv = convictionScore(ev, q, cfg);
    if (conv < cfg.minConviction) continue;
    ranked.push({ ev, q, conv });
  }
  if (ranked.length === 0) return { posted: 0, considered: pool.size };

  ranked.sort((a, b) => b.conv - a.conv);
  const best = ranked[0];
  const text = buildTweet(best.ev, best.q, cfg, nextStyle(cfg));
  const res = await postTweet(text);

  if (res.ok) {
    pool.delete(best.ev.id);
    await record({
      ts: now,
      eventId: best.ev.id,
      wallet: best.ev.wallet,
      tokenMint: best.ev.tokenMint,
      token: best.ev.token,
      tweetId: res.id,
    });
    // Mirror the premium pick to the Telegram signals channel (richer there:
    // the bare tweet + chart/socials + mint). Fail-soft — never blocks the tweet.
    if (cfg.mirrorTelegram) {
      await mirrorToTelegram(best.ev, best.q, best.conv).catch((e) =>
        console.error("[tweet] tg mirror failed:", e),
      );
    }
    console.log(
      `[tweet] posted (conv=${best.conv}) $${best.ev.token} ${res.id ?? ""}`.trim(),
    );
    return { posted: 1, considered: pool.size };
  }

  // Not configured — leave rate state untouched so real posting starts cleanly
  // once keys land; drop the preview so we don't re-log it forever.
  if (res.dryRun) {
    pool.delete(best.ev.id);
    return { posted: 0, considered: pool.size, blocked: "no-keys" };
  }

  // Duplicate content: consume it and set cooldowns so we don't retry the pair.
  if (res.duplicate) {
    pool.delete(best.ev.id);
    await record({
      ts: now,
      eventId: best.ev.id,
      wallet: best.ev.wallet,
      tokenMint: best.ev.tokenMint,
      token: best.ev.token,
    });
    return { posted: 0, considered: pool.size, blocked: "duplicate" };
  }

  // Rate-limited by X → keep the candidate and back off (our own spacing gate
  // will throttle the retry). Any other error → drop it so it can't wedge.
  if (!res.rateLimited) pool.delete(best.ev.id);
  return { posted: 0, considered: pool.size, blocked: res.error };
}

/** True when the X keys are present (channel posts for real, not dry-run). */
export function tweetChannelLive(): boolean {
  return twitterConfigured();
}
