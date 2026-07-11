import type { SmartEvent } from "./store";
import type { Segment } from "./wallets";
import type { WalletQuality } from "./walletQuality";

/**
 * Pure gate + copy + rate-limit logic for the auto-tweet channel. No I/O and no
 * runtime imports (types only), so it's cheap to unit-test and reason about. The
 * stateful orchestration (candidate pool, persistence, posting) lives in
 * `tweets.ts`, which composes these helpers.
 *
 * The whole point of this module is STRICTNESS: a Moby-style poster that stays
 * quiet. Every function here narrows what may be tweeted so the account reads as
 * high-signal — which is what keeps its reach healthy.
 */

// ───────────────────────────── config ─────────────────────────────

export interface TweetConfig {
  // Event-quality gate
  minUsd: number;
  minLiquidityUsd: number;
  minMcap: number;
  maxMcap: number; // 0 = no cap
  minTokenAgeMin: number;
  maxTokenAgeMin: number; // 0 = no cap
  requireAntirugOk: boolean;
  // Wallet-quality gate
  minWinRate: number;
  minClosedTrades: number;
  strictWinRate: boolean;
  allowedSegments: string[]; // ["*"] = any
  // Selection
  minConviction: number;
  candidateTtlMin: number;
  // Global rate limits (anti-spam)
  minSpacingSec: number;
  maxPerHour: number;
  maxPerDay: number;
  pairCooldownMin: number;
  tokenCooldownMin: number;
  // Copy
  styles: string[]; // enabled copy-style keys, rotated per tweet for variety
  whaleTag: string;
  showWinRate: boolean;
  includeChartLink: boolean;
  suffix: string;
  mirrorTelegram: boolean; // also post premium picks to the TG signals channel
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
}
function bool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  return raw === "true";
}

/**
 * Tweet copy styles. The dispatcher rotates through the enabled set
 * (TWEET_STYLES) so the timeline reads varied/organic instead of one repeated
 * template — which also stops X from flagging near-duplicate structure. Each
 * takes pre-formatted pieces and returns the tweet body (before suffix/link).
 * Add or edit freely.
 */
export interface StyleParts {
  whaleTag: string;
  amount: string; // "$210K"
  tok: string; // "$BONK"
  mc: string; // "$2.1B" or ""
  wr: number | null; // win-rate %, or null when not shown
}

export const STYLE_MAP: Record<string, (p: StyleParts) => string> = {
  classic: (p) =>
    `🐳 A ${p.whaleTag} just bought ${p.amount} of ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") +
    (p.wr ? ` · ${p.wr}% win-rate wallet` : ""),
  alert: (p) =>
    `🚨 Smart-money buy — ${p.amount} into ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") +
    (p.wr ? ` from a ${p.wr}% win-rate wallet` : ""),
  punchy: (p) =>
    `👀 A ${p.wr ? `${p.wr}% win-rate ` : ""}whale just aped ${p.amount} into ${p.tok}` +
    (p.mc ? ` (${p.mc} MC)` : ""),
  conviction: (p) =>
    `💎 High-conviction buy: ${p.amount} of ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") +
    (p.wr ? ` · ${p.wr}% win-rate wallet` : ""),
  flow: (p) =>
    `📊 Smart-money inflow → ${p.tok}: ${p.amount}` +
    (p.mc ? ` at ${p.mc} MC` : "") +
    (p.wr ? `. Wallet win-rate ${p.wr}%` : ""),
  fomo: (p) =>
    `🔥 Whales are loading ${p.tok} — ${p.amount} buy` +
    (p.mc ? ` at ${p.mc} MC` : "") +
    (p.wr ? ` from a ${p.wr}% win-rate wallet` : ""),
  minimal: (p) =>
    `🐳 ${p.amount} → ${p.tok}` +
    (p.mc ? ` at ${p.mc} MC` : "") +
    (p.wr ? ` · ${p.wr}% WR` : ""),
};

export const STYLE_KEYS = Object.keys(STYLE_MAP);

/** Enabled style keys from TWEET_STYLES (comma list); defaults to all. */
function parseStyles(): string[] {
  const list = (process.env.TWEET_STYLES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((k) => STYLE_MAP[k]);
  return list.length ? list : [...STYLE_KEYS];
}

export function loadConfig(): TweetConfig {
  const segs = (process.env.TWEET_ALLOWED_SEGMENTS ?? "smart,insider")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    minUsd: num("TWEET_MIN_USD", 5000),
    minLiquidityUsd: num("TWEET_MIN_LIQUIDITY_USD", 20000),
    minMcap: num("TWEET_MIN_MCAP", 100000),
    maxMcap: num("TWEET_MAX_MCAP", 50_000_000),
    minTokenAgeMin: num("TWEET_MIN_TOKEN_AGE_MIN", 30),
    maxTokenAgeMin: num("TWEET_MAX_TOKEN_AGE_MIN", 0),
    requireAntirugOk: bool("TWEET_REQUIRE_ANTIRUG_OK", true),
    minWinRate: num("TWEET_MIN_WIN_RATE", 60),
    minClosedTrades: num("TWEET_MIN_CLOSED_TRADES", 4),
    strictWinRate: bool("TWEET_STRICT_WINRATE", false),
    allowedSegments: segs.length ? segs : ["smart", "insider"],
    minConviction: num("TWEET_MIN_CONVICTION", 55),
    candidateTtlMin: num("TWEET_CANDIDATE_TTL_MIN", 20),
    minSpacingSec: num("TWEET_MIN_SPACING_SEC", 900),
    maxPerHour: num("TWEET_MAX_PER_HOUR", 4),
    maxPerDay: num("TWEET_MAX_PER_DAY", 24),
    pairCooldownMin: num("TWEET_PAIR_COOLDOWN_MIN", 1440),
    tokenCooldownMin: num("TWEET_TOKEN_COOLDOWN_MIN", 1440),
    styles: parseStyles(),
    whaleTag: process.env.TWEET_WHALE_TAG || "smart-money whale",
    showWinRate: bool("TWEET_SHOW_WINRATE", true),
    includeChartLink: bool("TWEET_INCLUDE_CHART_LINK", false),
    suffix: process.env.TWEET_SUFFIX || "",
    // The Telegram signals channel already gets every qualifying buy from
    // sendAlert() at ingest, so mirroring the tweeted pick would post the same
    // token twice. Off by default — sendAlert is the single Telegram poster.
    mirrorTelegram: bool("TWEET_MIRROR_TELEGRAM", false),
  };
}

// ───────────────────────────── copy ─────────────────────────────

/** Moby-style money: $24.95K, $146.86M, $1.2B (2dp, trailing zeros trimmed). */
export function fmtUsdTweet(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "";
  const a = Math.abs(n);
  const unit = (v: number, s: string) =>
    `$${v.toFixed(2).replace(/\.?0+$/, "")}${s}`;
  if (a >= 1e12) return unit(n / 1e12, "T");
  if (a >= 1e9) return unit(n / 1e9, "B");
  if (a >= 1e6) return unit(n / 1e6, "M");
  if (a >= 1e3) return unit(n / 1e3, "K");
  return `$${Math.round(n)}`;
}

/** Safe X cashtag — falls back to the bare symbol if it isn't cashtag-legal. */
export function cashtag(symbol: string): string {
  const s = (symbol || "").replace(/^\$+/, "").trim();
  if (/^[A-Za-z][A-Za-z0-9]{0,29}$/.test(s)) return `$${s}`;
  return s || "token";
}

export function buildTweet(
  ev: SmartEvent,
  quality: WalletQuality | undefined,
  cfg: TweetConfig,
  styleKey?: string,
): string {
  const amount = fmtUsdTweet(ev.amountUsd);
  const tok = cashtag(ev.token);
  const mc = ev.marketCapUsd != null ? fmtUsdTweet(ev.marketCapUsd) : "";
  const wr =
    cfg.showWinRate && quality?.observed && quality.winRate > 0
      ? quality.winRate
      : null;

  // Pick a style: explicit key wins; else the first enabled; else classic.
  const enabled = cfg.styles && cfg.styles.length ? cfg.styles : ["classic"];
  const key =
    styleKey && STYLE_MAP[styleKey]
      ? styleKey
      : STYLE_MAP[enabled[0]]
        ? enabled[0]
        : "classic";
  const line = STYLE_MAP[key]({ whaleTag: cfg.whaleTag, amount, tok, mc, wr });

  let out = line;
  if (cfg.includeChartLink && ev.tokenMint) {
    const link = ` 📊 dexscreener.com/solana/${ev.tokenMint}`;
    if (out.length + link.length <= 280) out += link;
  }
  if (cfg.suffix) {
    const suf = ` ${cfg.suffix}`;
    if (out.length + suf.length <= 280) out += suf;
  }
  if (out.length > 280) out = line; // drop suffix/link first
  if (out.length > 280) out = out.slice(0, 279) + "…";
  return out;
}

// ───────────────────────────── gates ─────────────────────────────

export interface GateResult {
  ok: boolean;
  reason?: string;
}

function walletGate(
  q: WalletQuality | undefined,
  cfg: TweetConfig,
): GateResult {
  const anySeg = cfg.allowedSegments.includes("*");
  if (!anySeg) {
    const seg = q?.segment as Segment | undefined;
    if (!seg || !cfg.allowedSegments.includes(seg))
      return { ok: false, reason: "segment" };
  }
  if (!q)
    return cfg.strictWinRate ? { ok: false, reason: "no-history" } : { ok: true };

  if (q.observed) {
    if (q.winRate >= cfg.minWinRate && q.pnlUsd > 0) return { ok: true };
    return { ok: false, reason: "low-winrate" };
  }
  // Not enough closed round-trips observed yet.
  if (cfg.strictWinRate) return { ok: false, reason: "insufficient-history" };
  return { ok: true }; // trust the curated / leaderboard segment at cold start
}

/** The strict per-event quality gate. Pure — safe to unit-test. */
export function hardGate(
  ev: SmartEvent,
  quality: WalletQuality | undefined,
  cfg: TweetConfig,
): GateResult {
  if (ev.action !== "buy") return { ok: false, reason: "not-buy" };
  if (!ev.tokenMint) return { ok: false, reason: "no-mint" };
  if (!(ev.amountUsd >= cfg.minUsd)) return { ok: false, reason: "small" };

  if (ev.risk?.verdict === "risk") return { ok: false, reason: "risk-high" };
  if (cfg.requireAntirugOk && ev.risk?.verdict !== "ok")
    return { ok: false, reason: `risk-${ev.risk?.verdict ?? "unknown"}` };

  if (cfg.minLiquidityUsd > 0) {
    if (ev.liquidityUsd == null || ev.liquidityUsd < cfg.minLiquidityUsd)
      return { ok: false, reason: "low-liq" };
  }

  // Only require/gate market cap when a bound is actually configured. With both
  // bounds off (0), a missing mcap shouldn't hard-block a buy.
  if (cfg.minMcap > 0 || cfg.maxMcap > 0) {
    if (ev.marketCapUsd == null) return { ok: false, reason: "no-mcap" };
    if (cfg.minMcap > 0 && ev.marketCapUsd < cfg.minMcap)
      return { ok: false, reason: "mcap-too-low" };
    if (cfg.maxMcap > 0 && ev.marketCapUsd > cfg.maxMcap)
      return { ok: false, reason: "mcap-too-high" };
  }

  // Age band applies only when age is known (liquidity + mcap + anti-rug already
  // screen out fresh rugs, so a missing pair-age shouldn't hard-block a buy).
  if (
    cfg.minTokenAgeMin > 0 &&
    ev.tokenAgeMin != null &&
    ev.tokenAgeMin < cfg.minTokenAgeMin
  )
    return { ok: false, reason: "too-new" };
  if (
    cfg.maxTokenAgeMin > 0 &&
    ev.tokenAgeMin != null &&
    ev.tokenAgeMin > cfg.maxTokenAgeMin
  )
    return { ok: false, reason: "too-old" };

  return walletGate(quality, cfg);
}

const clamp100 = (x: number) => Math.max(0, Math.min(100, x));

/** 0–100 conviction — ranks candidates so we tweet the best, not the first. */
export function convictionScore(
  ev: SmartEvent,
  quality: WalletQuality | undefined,
  cfg: TweetConfig,
): number {
  const wr = quality?.observed ? quality.winRate : cfg.minWinRate;
  const winComp = clamp100(wr);
  const sizeComp = clamp100(((Math.log10(Math.max(ev.amountUsd, 1)) - 3) / 3) * 100); // $1k→0, $1M→100
  const liq = ev.liquidityUsd ?? 0;
  const liqComp = clamp100(((Math.log10(Math.max(liq, 1)) - 3.3) / 2.7) * 100); // ~$2k→0, $1M→100
  const pnl = quality?.pnlUsd ?? 0;
  const pnlComp = pnl > 0 ? clamp100(((Math.log10(pnl) - 3) / 3) * 100) : 0;
  return Math.round(0.45 * winComp + 0.3 * sizeComp + 0.15 * liqComp + 0.1 * pnlComp);
}

// ─────────────────────── rate-limit helpers (pure) ───────────────────────

export interface PostedTweet {
  ts: number;
  eventId: string;
  wallet: string;
  tokenMint?: string;
  token: string;
  tweetId?: string;
  style?: string; // copy style used — drives least-recently-used rotation
}

/**
 * Pick the next copy style with a least-recently-used rotation derived from the
 * persisted history — NOT an in-memory counter. A counter resets to 0 on every
 * worker/server restart, which pins every tweet to the first style ("classic")
 * and makes the timeline read as one repeated template. Deriving from history
 * survives restarts: whichever enabled style was used longest ago (or never)
 * wins, so consecutive posts stay varied no matter how often the process cycles.
 */
export function pickStyle(hist: PostedTweet[], cfg: TweetConfig): string {
  const enabled = cfg.styles && cfg.styles.length ? cfg.styles : ["classic"];
  // Most-recent post timestamp per style key.
  const lastUsed = new Map<string, number>();
  for (const p of hist) {
    if (!p.style) continue;
    const prev = lastUsed.get(p.style) ?? 0;
    if (p.ts > prev) lastUsed.set(p.style, p.ts);
  }
  // Prefer a never-used style; otherwise the one idle the longest.
  let best = enabled[0];
  let bestTs = Infinity;
  for (const key of enabled) {
    const ts = lastUsed.get(key) ?? 0; // never used → 0 → wins immediately
    if (ts < bestTs) {
      bestTs = ts;
      best = key;
    }
  }
  return best;
}

function lastPostAt(hist: PostedTweet[]): number {
  let m = 0;
  for (const p of hist) if (p.ts > m) m = p.ts;
  return m;
}

/** Global pacing gate — the core anti-spam lever. Pure. */
export function globalRateGate(
  hist: PostedTweet[],
  now: number,
  cfg: TweetConfig,
): GateResult {
  if (now - lastPostAt(hist) < cfg.minSpacingSec * 1000)
    return { ok: false, reason: "spacing" };
  const inHour = hist.filter((p) => now - p.ts < 3_600_000).length;
  if (inHour >= cfg.maxPerHour) return { ok: false, reason: "hourly-cap" };
  const inDay = hist.filter((p) => now - p.ts < 86_400_000).length;
  if (inDay >= cfg.maxPerDay) return { ok: false, reason: "daily-cap" };
  return { ok: true };
}

/** Per-token / per-wallet+token novelty cooldown. Pure. */
export function noveltyBlocked(
  hist: PostedTweet[],
  ev: SmartEvent,
  now: number,
  cfg: TweetConfig,
): boolean {
  const mint = ev.tokenMint;
  if (!mint) return false;
  for (const p of hist) {
    if (p.tokenMint !== mint) continue;
    if (now - p.ts < cfg.tokenCooldownMin * 60_000) return true;
    if (p.wallet === ev.wallet && now - p.ts < cfg.pairCooldownMin * 60_000)
      return true;
  }
  return false;
}
