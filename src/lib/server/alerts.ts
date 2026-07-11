import type { SmartEvent } from "./store";

/** Low-level Telegram sendMessage to any chat. No-op (logs) without a token. */
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
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[tg] error:", await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[tg] send failed:", e);
    return false;
  }
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
const BUY_VERB = ["bought", "grabbed", "scooped", "loaded up", "aped"];
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
// varied. Each stays clean, one line, and scale-aware. Set ALERT_STYLES (comma
// list of indices, e.g. "0,1,4") to restrict the rotation.
interface AlertParts {
  isBuy: boolean;
  emoji: string; // scale/action emoji (🐳 / 🟢 / 🔴)
  who: string; // "Whale" | "Smart money"
  verb: string; // bought / grabbed / sold / ...
  amount: string; // "$1.2K"
  tok: string; // "$PEPE"
  mc: string; // "$2M" or ""
}
const ALERT_STYLES: ((p: AlertParts) => string)[] = [
  // 0 · classic
  (p) =>
    `${p.emoji} <b>${p.who} ${p.verb} ${p.amount}</b> of <b>${p.tok}</b>${p.mc ? ` at ${p.mc} MC` : ""}`,
  // 1 · ticker-first
  (p) =>
    `${p.emoji} <b>${p.tok}</b> · ${p.who} ${p.verb} <b>${p.amount}</b>${p.mc ? ` · ${p.mc} MC` : ""}`,
  // 2 · alert
  (p) =>
    `🚨 <b>${p.isBuy ? "BUY" : "SELL"} ALERT</b> — <b>${p.amount}</b> ${p.isBuy ? "into" : "out of"} <b>${p.tok}</b>${p.mc ? ` (${p.mc} MC)` : ""}`,
  // 3 · flow
  (p) =>
    `📊 <b>${p.isBuy ? "Inflow" : "Outflow"}</b> → <b>${p.tok}</b>: ${p.who} ${p.amount}${p.mc ? ` · ${p.mc} MC` : ""}`,
  // 4 · punchy
  (p) =>
    `${p.emoji} <b>${p.tok}</b> — ${p.who.toLowerCase()} just ${p.verb} <b>${p.amount}</b>${p.mc ? ` (${p.mc} MC)` : ""}`,
  // 5 · minimal
  (p) =>
    `${p.emoji} <b>${p.tok}</b> · ${p.amount} ${p.isBuy ? "buy" : "sell"}${p.mc ? ` · ${p.mc} MC` : ""}`,
  // 6 · hype (buy) / trim (sell)
  (p) =>
    p.isBuy
      ? `🔥 <b>Smart money is loading ${p.tok}</b> — ${p.amount} buy${p.mc ? ` at ${p.mc} MC` : ""}`
      : `📤 <b>Smart money is trimming ${p.tok}</b> — ${p.amount} sell${p.mc ? ` at ${p.mc} MC` : ""}`,
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

/** Compact anti-rug tag for the metrics line. */
function antirugTag(ev: SmartEvent): string | null {
  const r = ev.risk;
  if (!r || r.verdict === "unknown") return null;
  if (r.verdict === "ok") return "🛡 safe";
  if (r.verdict === "caution") return "⚠️ caution";
  return "⛔ risky";
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
  if (socials?.website) parts.push(`🌐 <a href="${socials.website}">Website</a>`);
  if (socials?.twitter) parts.push(`🐦 <a href="${socials.twitter}">X</a>`);
  if (socials?.telegram)
    parts.push(`💬 <a href="${socials.telegram}">Telegram</a>`);
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

function gate(ev: SmartEvent): { ok: boolean; reason?: string } {
  if (ev.risk?.verdict === "risk" && process.env.ALERT_ON_RISK !== "true") {
    return { ok: false, reason: "risk-suppressed" };
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
    !["smart", "active", "toppnl", "highwr", ev.segment].includes(
      ev.label.toLowerCase(),
    )
      ? ` <i>(${ev.label})</i>`
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
    tok: `$${ev.token}`,
    mc: ev.marketCapUsd != null ? (fmtUsd(ev.marketCapUsd) ?? "") : "",
  };
  const styles = enabledAlertStyles();
  const headline = styles[hashIdx(seed, styles.length)](parts);
  const wallet = `<a href="https://solscan.io/account/${ev.wallet}">${ev.walletShort}</a>`;

  // Compact metrics: liquidity · age · anti-rug (mcap already in the headline).
  const meta = [
    ev.liquidityUsd != null ? `💧 ${fmtUsd(ev.liquidityUsd)} liq` : null,
    fmtAge(ev.tokenAgeMin) ? `🕒 ${fmtAge(ev.tokenAgeMin)}` : null,
    antirugTag(ev),
  ].filter(Boolean);

  const lines = [
    headline,
    `${wallet}${label}`,
    meta.length ? meta.join("  ·  ") : null,
    ev.tokenMint ? `<code>${ev.tokenMint}</code>` : null,
    socialLinks(ev.tokenMint, ev.socials),
  ].filter(Boolean) as string[];

  await postToChannel(lines.join("\n"));
}
