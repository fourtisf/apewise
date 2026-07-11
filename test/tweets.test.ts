import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmtUsdTweet,
  cashtag,
  buildTweet,
  hardGate,
  convictionScore,
  globalRateGate,
  noveltyBlocked,
  pickStyle,
  loadConfig,
  type TweetConfig,
  type PostedTweet,
} from "../src/lib/server/tweetGate.ts";
import type { WalletQuality } from "../src/lib/server/walletQuality.ts";

const cfg = (over: Partial<TweetConfig> = {}): TweetConfig => ({
  minUsd: 5000,
  minLiquidityUsd: 20000,
  minMcap: 100000,
  maxMcap: 50_000_000,
  minTokenAgeMin: 30,
  maxTokenAgeMin: 0,
  requireAntirugOk: true,
  minWinRate: 60,
  minClosedTrades: 4,
  strictWinRate: false,
  allowedSegments: ["smart", "insider"],
  minConviction: 55,
  candidateTtlMin: 20,
  minSpacingSec: 900,
  maxPerHour: 4,
  maxPerDay: 24,
  pairCooldownMin: 720,
  tokenCooldownMin: 180,
  styles: ["classic", "alert", "punchy", "conviction", "flow", "fomo", "minimal"],
  whaleTag: "smart-money whale",
  showWinRate: true,
  includeChartLink: false,
  suffix: "",
  mirrorTelegram: false,
  ...over,
});

const ev = (over: Record<string, unknown> = {}) =>
  ({
    id: "e1",
    ts: Date.now(),
    chain: "solana",
    wallet: "WALLET_A",
    walletShort: "WALL",
    segment: "smart",
    action: "buy",
    token: "PEPE",
    tokenMint: "MINT_PEPE",
    amountUsd: 25000,
    marketCapUsd: 2_000_000,
    liquidityUsd: 80000,
    tokenAgeMin: 240,
    risk: { verdict: "ok", reasons: [] },
    ...over,
  }) as never;

const quality = (over: Partial<WalletQuality> = {}): WalletQuality => ({
  wallet: "WALLET_A",
  segment: "smart",
  winRate: 75,
  closedTrades: 8,
  pnlUsd: 120000,
  trades: 20,
  observed: true,
  ...over,
});

// ── formatting ──────────────────────────────────────────────────────────────
test("fmtUsdTweet: Moby-style units, trailing zeros trimmed", () => {
  assert.equal(fmtUsdTweet(24950), "$24.95K");
  assert.equal(fmtUsdTweet(146_860_000), "$146.86M");
  assert.equal(fmtUsdTweet(3_200_000), "$3.2M");
  assert.equal(fmtUsdTweet(25000), "$25K");
  assert.equal(fmtUsdTweet(1_200_000_000), "$1.2B");
  assert.equal(fmtUsdTweet(940), "$940");
  assert.equal(fmtUsdTweet(undefined), "");
});

test("cashtag: legal symbols get a $, weird ones fall back", () => {
  assert.equal(cashtag("Fartcoin"), "$Fartcoin");
  assert.equal(cashtag("$mSOL"), "$mSOL");
  assert.equal(cashtag("ABC…WXYZ"), "ABC…WXYZ"); // shortened mint, no cashtag
  assert.equal(cashtag(""), "token");
});

// ── copy ────────────────────────────────────────────────────────────────────
test("buildTweet: Moby-style line with win-rate flair", () => {
  const t = buildTweet(ev(), quality(), cfg());
  assert.match(t, /^🐳 A smart-money whale just bought \$25K of \$PEPE at \$2M MC/);
  assert.match(t, /75% win-rate wallet/);
  assert.ok(t.length <= 280);
});

test("buildTweet: no flair when win-rate not observed", () => {
  const t = buildTweet(ev(), quality({ observed: false }), cfg());
  assert.doesNotMatch(t, /win-rate/);
});

test("buildTweet: never exceeds 280 chars", () => {
  const t = buildTweet(ev({ token: "A".repeat(40) }), quality(), cfg({ suffix: "x".repeat(400) }));
  assert.ok(t.length <= 280);
});

test("buildTweet: each style renders distinct, valid copy", () => {
  const keys = ["classic", "alert", "punchy", "conviction", "flow", "fomo", "minimal"];
  const texts = keys.map((k) => buildTweet(ev(), quality(), cfg(), k));
  assert.equal(new Set(texts).size, texts.length); // all different
  for (const t of texts) {
    assert.ok(t.length <= 280);
    assert.match(t, /\$PEPE/); // cashtag present in every style
  }
  // unknown style key falls back to the first enabled style (classic)
  assert.equal(buildTweet(ev(), quality(), cfg(), "nope"), buildTweet(ev(), quality(), cfg(), "classic"));
});

// ── config / moby mode ────────────────────────────────────────────────────────
test("loadConfig: Moby mode flips to a high-frequency, loose gate", () => {
  const saved = { ...process.env };
  try {
    // Strict defaults (moby off).
    for (const k of Object.keys(process.env))
      if (k.startsWith("TWEET_")) delete process.env[k];
    const strict = loadConfig();
    assert.equal(strict.minUsd, 5000);
    assert.equal(strict.maxMcap, 50_000_000);
    assert.equal(strict.maxPerHour, 4);
    assert.equal(strict.minWinRate, 60);

    // Moby mode: $1k floor, no mcap cap, frequent, no win-rate gate.
    process.env.TWEET_MOBY_MODE = "true";
    const moby = loadConfig();
    assert.equal(moby.minUsd, 1000);
    assert.equal(moby.maxMcap, 0); // no upper cap → big-cap tokens pass
    assert.equal(moby.minWinRate, 0);
    assert.equal(moby.minConviction, 0);
    assert.equal(moby.minSpacingSec, 60);
    assert.ok(moby.maxPerHour >= 20);

    // An explicit env var still overrides a Moby-mode default.
    process.env.TWEET_MIN_USD = "2500";
    assert.equal(loadConfig().minUsd, 2500);
  } finally {
    for (const k of Object.keys(process.env))
      if (k.startsWith("TWEET_")) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

// ── style rotation ────────────────────────────────────────────────────────────
test("pickStyle: least-recently-used, survives an empty history", () => {
  const c = cfg({ styles: ["classic", "alert", "punchy"] });
  // Empty history → first enabled style.
  assert.equal(pickStyle([], c), "classic");
  const p = (style: string, ts: number): PostedTweet => ({
    ts,
    eventId: style,
    wallet: "w",
    token: "T",
    style,
  });
  // classic + alert used, punchy never → punchy wins.
  assert.equal(pickStyle([p("classic", 100), p("alert", 200)], c), "punchy");
  // all used → the one idle the longest (classic at ts 100).
  assert.equal(
    pickStyle([p("classic", 100), p("alert", 200), p("punchy", 300)], c),
    "classic",
  );
  // history entries for disabled styles are ignored.
  assert.equal(pickStyle([p("flow", 999), p("classic", 100)], c), "alert");
  // cold start: history has NO style field (predates tracking) → rotate by count
  // so it doesn't always land on classic.
  const noStyle = (ts: number): PostedTweet => ({ ts, eventId: "x", wallet: "w", token: "T" });
  assert.equal(pickStyle([noStyle(1), noStyle(2)], c), "punchy"); // 2 % 3 → punchy
  assert.equal(pickStyle([noStyle(1)], c), "alert"); // 1 % 3 → alert
});

// ── hard gate ───────────────────────────────────────────────────────────────
test("hardGate: a clean high-win-rate buy passes", () => {
  assert.equal(hardGate(ev(), quality(), cfg()).ok, true);
});

test("hardGate: rejects sells, small buys, thin liquidity", () => {
  assert.equal(hardGate(ev({ action: "sell" }), quality(), cfg()).reason, "not-buy");
  assert.equal(hardGate(ev({ amountUsd: 100 }), quality(), cfg()).reason, "small");
  assert.equal(hardGate(ev({ liquidityUsd: 1000 }), quality(), cfg()).reason, "low-liq");
});

test("hardGate: anti-rug — risk always blocked, caution/unknown blocked in strict mode", () => {
  assert.equal(hardGate(ev({ risk: { verdict: "risk", reasons: [] } }), quality(), cfg()).reason, "risk-high");
  assert.equal(hardGate(ev({ risk: { verdict: "caution", reasons: [] } }), quality(), cfg()).reason, "risk-caution");
  assert.equal(hardGate(ev({ risk: { verdict: "unknown", reasons: [] } }), quality(), cfg()).reason, "risk-unknown");
  // relaxed: caution allowed, but a known rug is still blocked
  assert.equal(hardGate(ev({ risk: { verdict: "caution", reasons: [] } }), quality(), cfg({ requireAntirugOk: false })).ok, true);
  assert.equal(hardGate(ev({ risk: { verdict: "risk", reasons: [] } }), quality(), cfg({ requireAntirugOk: false })).reason, "risk-high");
});

test("hardGate: market-cap band + freshness", () => {
  assert.equal(hardGate(ev({ marketCapUsd: 50000 }), quality(), cfg()).reason, "mcap-too-low");
  assert.equal(hardGate(ev({ marketCapUsd: 9e8 }), quality(), cfg()).reason, "mcap-too-high");
  // mcap not required when both bounds are off (0)
  assert.equal(hardGate(ev({ marketCapUsd: undefined }), quality(), cfg({ minMcap: 0, maxMcap: 0 })).ok, true);
  assert.equal(hardGate(ev({ marketCapUsd: undefined }), quality(), cfg()).reason, "no-mcap");
  assert.equal(hardGate(ev({ tokenAgeMin: 5 }), quality(), cfg()).reason, "too-new");
  // unknown age does not hard-block (liquidity+mcap+antirug already screen rugs)
  assert.equal(hardGate(ev({ tokenAgeMin: undefined }), quality(), cfg()).ok, true);
});

test("hardGate: wallet quality is the decisive smart-money filter", () => {
  // low win rate → blocked even if everything else is pristine
  assert.equal(hardGate(ev(), quality({ winRate: 40 }), cfg()).reason, "low-winrate");
  // wrong segment → blocked
  assert.equal(hardGate(ev(), quality({ segment: "kol" }), cfg()).reason, "segment");
  // cold start (not observed) → trusted by default, blocked under strict mode
  assert.equal(hardGate(ev(), quality({ observed: false }), cfg()).ok, true);
  assert.equal(hardGate(ev(), quality({ observed: false }), cfg({ strictWinRate: true })).reason, "insufficient-history");
});

// ── conviction ──────────────────────────────────────────────────────────────
test("convictionScore: rewards higher win-rate and larger size", () => {
  const strong = convictionScore(ev({ amountUsd: 500000 }), quality({ winRate: 90 }), cfg());
  const weak = convictionScore(ev({ amountUsd: 6000 }), quality({ winRate: 61 }), cfg());
  assert.ok(strong > weak);
  assert.ok(strong <= 100 && weak >= 0);
});

// ── rate limiting ───────────────────────────────────────────────────────────
test("globalRateGate: min spacing between tweets", () => {
  const now = 10_000_000_000;
  const hist: PostedTweet[] = [{ ts: now - 60_000, eventId: "x", wallet: "w", token: "T" }];
  assert.equal(globalRateGate(hist, now, cfg()).reason, "spacing"); // 60s < 900s
  assert.equal(globalRateGate(hist, now, cfg({ minSpacingSec: 30 })).ok, true);
});

test("globalRateGate: hourly and daily caps", () => {
  const now = 10_000_000_000;
  const many = (n: number, ageMs: number): PostedTweet[] =>
    Array.from({ length: n }, (_, i) => ({ ts: now - ageMs - i, eventId: `e${i}`, wallet: "w", token: "T" }));
  // 4 in the last hour (spacing satisfied by ageMs) → hourly cap hit
  assert.equal(globalRateGate(many(4, 20 * 60_000), now, cfg()).reason, "hourly-cap");
  // spread across the day, under hourly but at daily cap
  const day = Array.from({ length: 24 }, (_, i) => ({ ts: now - (i + 1) * 40 * 60_000, eventId: `d${i}`, wallet: "w", token: "T" }));
  assert.equal(globalRateGate(day, now, cfg()).reason, "daily-cap");
});

test("noveltyBlocked: token + wallet cooldowns", () => {
  const now = 10_000_000_000;
  const hist: PostedTweet[] = [
    { ts: now - 60 * 60_000, eventId: "p", wallet: "OTHER", tokenMint: "MINT_PEPE", token: "PEPE" },
  ];
  // same token, 1h ago, token cooldown 180m → blocked
  assert.equal(noveltyBlocked(hist, ev({ wallet: "WALLET_A" }), now, cfg()), true);
  // token cooldown elapsed but same wallet+token within pair cooldown → still blocked
  const old: PostedTweet[] = [
    { ts: now - 200 * 60_000, eventId: "p", wallet: "WALLET_A", tokenMint: "MINT_PEPE", token: "PEPE" },
  ];
  assert.equal(noveltyBlocked(old, ev({ wallet: "WALLET_A" }), now, cfg()), true);
  // different token entirely → allowed
  assert.equal(noveltyBlocked(hist, ev({ tokenMint: "MINT_OTHER" }), now, cfg()), false);
});
