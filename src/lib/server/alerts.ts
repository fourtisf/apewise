import type { SmartEvent } from "./store";
// walletQuality is imported dynamically inside sendAlert (like solanaRpc's
// runtime deps): it pulls in store/score at module load, whose extensionless
// relative imports don't resolve under plain `node --test`.

/**
 * Escape text interpolated into Telegram HTML (parse_mode: "HTML"). Token
 * symbols/labels are arbitrary on Solana — an unescaped `&`, `<` or `>` makes
 * the whole sendMessage fail with 400 "can't parse entities" and the alert is
 * lost. `"` is included so the same helper is safe inside attribute values.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Low-level Telegram sendMessage to any chat. No-op (logs) without a token.
 * Retries transient failures (network, 5xx, 429 honoring `retry_after`) — the
 * caller has already marked the event as ingested, so a dropped send here was
 * an alert lost forever.
 */
export async function tgSend(
  chatId: string | number,
  text: string,
  replyMarkup?: unknown,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log(`[tg] (no token)\n${text}`);
    return false;
  }
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
      if (res.ok) return true;
      const errText = await res.text().catch(() => "");
      if (res.status === 429 && attempt < ATTEMPTS) {
        // Telegram says exactly how long to wait; anything longer than ~30s
        // isn't worth stalling the ingest path for.
        let wait = 2;
        try {
          wait = Number(JSON.parse(errText)?.parameters?.retry_after) || 2;
        } catch {
          /* keep default */
        }
        if (wait <= 30) {
          await sleep(wait * 1000 + 250);
          continue;
        }
      } else if (res.status >= 500 && attempt < ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
      console.error("[tg] error:", res.status, errText.slice(0, 300));
      return false;
    } catch (e) {
      if (attempt < ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
      console.error("[tg] send failed:", e);
      return false;
    }
  }
  return false;
}

/** Post to the signals channel (TELEGRAM_SIGNALS_CHAT_ID, e.g. @apewisesignals). */
export async function postToChannel(
  text: string,
  replyMarkup?: unknown,
): Promise<boolean> {
  const chatId = process.env.TELEGRAM_SIGNALS_CHAT_ID;
  if (!chatId) {
    console.log(`[tg] (no channel)\n${text}`);
    return false;
  }
  return tgSend(chatId, text, replyMarkup);
}

export function fmtUsd(n?: number): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const a = Math.abs(n);
  // Trim trailing zeros so it reads $2M / $414M, not $2.00M / $414.00M.
  const u = (v: number, s: string) =>
    `$${v.toFixed(2).replace(/\.?0+$/, "")}${s}`;
  if (a >= 1e12) return u(n / 1e12, "T");
  if (a >= 1e9) return u(n / 1e9, "B");
  if (a >= 1_000_000) return u(n / 1_000_000, "M");
  if (a >= 1000) return `$${(n / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

// Light verb variety so the channel doesn't read as one repeated template,
// picked by a stateless hash of the event so it's stable per event and survives
// restarts. The framing stays clean + Moby-like (one headline sentence); the
// "whale vs smart money" descriptor is SCALE-AWARE so a tiny $25 trade is never
// announced as a "whale".
const BUY_VERB = ["bought", "accumulated", "added", "scooped", "aped"];
const SELL_VERB = ["sold", "offloaded", "trimmed", "exited", "dumped"];

/** "Whale" only when the trade is actually big; else "Smart money". */
function descriptor(amountUsd: number): string {
  const whale = Number(process.env.ALERT_WHALE_USD) || 25000;
  return amountUsd >= whale ? "Whale" : "Smart money";
}

/** Stateless string→[0,n) hash (djb2). Same input → same index, always. */
function hashIdx(s: string, n: number): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return n > 0 ? h % n : 0;
}

// Distinct Telegram HEADLINE styles — like the X copy styles, but for the
// channel. The whole framing/structure changes between them (not just the verb),
// and one is chosen per event by the stateless hash so consecutive alerts read
// varied. Headlines carry ONLY action + size + ticker; market data lives on a
// labeled metrics line below, so every post scans the same way. Set
// ALERT_STYLES (comma list of indices, e.g. "0,2,4") to restrict the rotation.
interface AlertParts {
  isBuy: boolean;
  emoji: string; // scale/action emoji (🐳 / 🟢 / 🔴)
  who: string; // "Whale" | "Smart money"
  verb: string; // bought / accumulated / sold / ...
  amount: string; // "$1.2K"
  tok: string; // "$PEPE"
}
const ALERT_STYLES: ((p: AlertParts) => string)[] = [
  // 0 · action-first
  (p) =>
    `${p.emoji} <b>${p.who.toUpperCase()} ${p.isBuy ? "BUY" : "SELL"}</b> — <b>${p.amount}</b> ${p.isBuy ? "into" : "out of"} <b>${p.tok}</b>`,
  // 1 · ticker-first
  (p) =>
    `${p.emoji} <b>${p.tok}</b> — ${p.who.toLowerCase()} just ${p.verb} <b>${p.amount}</b>`,
  // 2 · signal
  (p) =>
    `🚨 <b>${p.isBuy ? "BUY" : "SELL"} SIGNAL</b> · <b>${p.tok}</b> · <b>${p.amount}</b>`,
  // 3 · flow
  (p) =>
    `${p.isBuy ? "📈" : "📉"} <b>${p.isBuy ? "Accumulation" : "Distribution"}</b> — ${p.who.toLowerCase()} ${p.verb} <b>${p.amount}</b> of <b>${p.tok}</b>`,
  // 4 · narrative
  (p) =>
    p.isBuy
      ? `🔥 <b>Smart money is loading ${p.tok}</b> — ${p.amount} buy`
      : `📤 <b>Smart money is exiting ${p.tok}</b> — ${p.amount} sell`,
];

/** Enabled headline styles from ALERT_STYLES (comma indices); default all. */
function enabledAlertStyles(): ((p: AlertParts) => string)[] {
  const raw = process.env.ALERT_STYLES;
  if (!raw) return ALERT_STYLES;
  const picked = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < ALERT_STYLES.length)
    .map((i) => ALERT_STYLES[i]);
  return picked.length ? picked : ALERT_STYLES;
}

/** Labeled anti-rug line — says WHY when there's a concern, not just an emoji. */
function antirugLine(ev: SmartEvent): string | null {
  const r = ev.risk;
  if (!r || r.verdict === "unknown") return null;
  if (r.verdict === "ok") return "🛡 Anti-rug: passed";
  const why = r.reasons[0] ? ` — ${escapeHtml(r.reasons[0])}` : "";
  if (r.verdict === "caution") return `⚠️ Anti-rug: caution${why}`;
  return `⛔ Anti-rug: high risk${why}`;
}

function fmtAge(min?: number): string | null {
  if (min == null) return null;
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  const days = min / 1440;
  if (days < 365) return `${Math.round(days)}d`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * Inline text links for the message body (no buttons): Chart + the token's own
 * website / X / Telegram, shown only when known. Rendered as HTML <a> links;
 * web previews are disabled in tgSend so they stay compact.
 */
export function socialLinks(
  mint?: string,
  socials?: SmartEvent["socials"],
): string | null {
  const parts: string[] = [];
  if (mint)
    parts.push(`📊 <a href="https://dexscreener.com/solana/${mint}">Chart</a>`);
  if (socials?.website)
    parts.push(`🌐 <a href="${escapeHtml(socials.website)}">Website</a>`);
  if (socials?.twitter)
    parts.push(`🐦 <a href="${escapeHtml(socials.twitter)}">X</a>`);
  if (socials?.telegram)
    parts.push(`💬 <a href="${escapeHtml(socials.telegram)}">Telegram</a>`);
  return parts.length ? parts.join("  ·  ") : null;
}

const lastAlertAt = new Map<string, number>(); // per wallet+token
const lastWalletAt = new Map<string, number>(); // per wallet (any token)
const COOLDOWN = (Number(process.env.ALERT_COOLDOWN_SEC) || 60) * 1000;
// Per-wallet cooldown: one wallet dumping several tokens in one cycle should not
// post a wall of near-identical alerts (reads as "double"). 0 disables.
const WALLET_COOLDOWN =
  (process.env.ALERT_WALLET_COOLDOWN_SEC == null
    ? 90
    : Number(process.env.ALERT_WALLET_COOLDOWN_SEC)) * 1000;
// Floor on alert size — applies to BUYS AND SELLS so dust swaps (a $25 sell)
// never spam the channel. This is what makes it read as a signal, not a feed.
const MIN_USD = Number(process.env.ALERT_MIN_USD) || 1000;
// Dead/rugged pools ("whale offloaded $34k" of a $0-liquidity token) read as
// noise and erode trust. Skip when liquidity is KNOWN and below the floor;
// unknown liquidity still passes (fail-soft). 0 disables.
const MIN_LIQ_USD =
  process.env.ALERT_MIN_LIQUIDITY_USD == null
    ? 1000
    : Number(process.env.ALERT_MIN_LIQUIDITY_USD);

function gate(ev: SmartEvent): { ok: boolean; reason?: string } {
  if (ev.risk?.verdict === "risk" && process.env.ALERT_ON_RISK !== "true") {
    return { ok: false, reason: "risk-suppressed" };
  }
  if (
    MIN_LIQ_USD > 0 &&
    ev.liquidityUsd != null &&
    ev.liquidityUsd < MIN_LIQ_USD
  ) {
    return { ok: false, reason: "thin-liq" };
  }
  if (process.env.ALERT_BUYS_ONLY === "true" && ev.action !== "buy") {
    return { ok: false, reason: "sells-off" };
  }
  if (MIN_USD > 0 && (ev.amountUsd == null || ev.amountUsd < MIN_USD)) {
    return { ok: false, reason: "below-min-usd" };
  }
  const now = Date.now();
  if (
    WALLET_COOLDOWN > 0 &&
    now - (lastWalletAt.get(ev.wallet) || 0) < WALLET_COOLDOWN
  ) {
    return { ok: false, reason: "wallet-cooldown" };
  }
  const key = `${ev.wallet}:${ev.tokenMint || ev.token}`;
  if (now - (lastAlertAt.get(key) || 0) < COOLDOWN) {
    return { ok: false, reason: "cooldown" };
  }
  lastAlertAt.set(key, now);
  lastWalletAt.set(ev.wallet, now);
  return { ok: true };
}

/** Smart-money alert (tracked-wallet swap via Helius) → signals channel. */
export async function sendAlert(ev: SmartEvent): Promise<void> {
  const g = gate(ev);
  if (!g.ok) {
    console.log(`[alert] skipped (${g.reason}) ${ev.action} ${ev.token}`);
    return;
  }

  const isBuy = ev.action === "buy";
  const amount = fmtUsd(ev.amountUsd);
  // A KOL's real name is worth showing; generic/source labels aren't.
  const label =
    ev.label &&
    !["smart", "active", "toppnl", "highwr", "toptrader", ev.segment].includes(
      ev.label.toLowerCase(),
    )
      ? ` <i>(${escapeHtml(ev.label)})</i>`
      : "";

  // Headline: pick one of several distinct styles per event (stateless hash) so
  // the channel reads varied like the X feed. Scale-aware + light verb variety.
  const seed = `${ev.wallet}:${ev.tokenMint || ev.token}:${ev.action}`;
  const who = descriptor(ev.amountUsd);
  const verbs = isBuy ? BUY_VERB : SELL_VERB;
  const emoji = isBuy ? (who === "Whale" ? "🐳" : "🟢") : "🔴";
  const parts: AlertParts = {
    isBuy,
    emoji,
    who,
    verb: verbs[hashIdx(seed + "#v", verbs.length)],
    amount: amount ?? "",
    tok: `$${escapeHtml(ev.token)}`,
  };
  const styles = enabledAlertStyles();
  const headline = styles[hashIdx(seed, styles.length)](parts);
  const wallet = `<a href="https://solscan.io/account/${ev.wallet}">${ev.walletShort}</a>`;

  // Trader credibility: observed win-rate when we have enough history — the
  // single stat that separates a "signal" from a random trade. Fail-soft.
  let wrTag = "";
  try {
    const { getWalletQuality } = await import("./walletQuality");
    const q = await getWalletQuality(ev.wallet);
    if (q?.observed && q.winRate > 0)
      wrTag = `  ·  🎯 <b>${q.winRate}%</b> win-rate`;
  } catch {
    /* never block an alert on the stats engine */
  }

  // Labeled metrics so every post scans identically: MC · Liq · Age. Hide
  // fields we don't know instead of printing "$0" (reads as broken data).
  const metrics = [
    ev.marketCapUsd != null ? `💰 MC <b>${fmtUsd(ev.marketCapUsd)}</b>` : null,
    ev.liquidityUsd != null && ev.liquidityUsd > 0
      ? `💧 Liq <b>${fmtUsd(ev.liquidityUsd)}</b>`
      : null,
    fmtAge(ev.tokenAgeMin) ? `🕒 Age ${fmtAge(ev.tokenAgeMin)}` : null,
  ].filter(Boolean);

  const lines = [
    headline,
    "",
    `👤 ${wallet}${label}${wrTag}`,
    metrics.length ? metrics.join("  ·  ") : null,
    antirugLine(ev),
    ev.tokenMint ? `<code>${ev.tokenMint}</code>` : null,
    socialLinks(ev.tokenMint, ev.socials),
  ].filter((l) => l !== null) as string[];

  await postToChannel(lines.join("\n"));
}
