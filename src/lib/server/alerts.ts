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
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

const SEG_EMOJI: Record<SmartEvent["segment"], string> = {
  smart: "🟢",
  sniper: "⚡",
  insider: "🔴",
  kol: "🎤",
};

const SEG_LABEL: Record<SmartEvent["segment"], string> = {
  smart: "Smart money",
  sniper: "Sniper",
  insider: "Insider",
  kol: "KOL",
};

function fmtAge(min?: number): string | null {
  if (min == null) return null;
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

function riskLine(ev: SmartEvent): string | null {
  const r = ev.risk;
  if (!r || r.verdict === "unknown") return null;
  if (r.verdict === "ok") return "🛡 Anti-rug: passed";
  const reasons = r.reasons.slice(0, 2).join(" · ") || "checks flagged";
  if (r.verdict === "caution") return `⚠️ Caution · ${reasons}`;
  return `⛔ High risk · ${reasons}`;
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

// Per wallet+token cooldown (anti-spam).
const lastAlertAt = new Map<string, number>();
const COOLDOWN = (Number(process.env.ALERT_COOLDOWN_SEC) || 60) * 1000;

function gate(ev: SmartEvent): { ok: boolean; reason?: string } {
  if (ev.risk?.verdict === "risk" && process.env.ALERT_ON_RISK !== "true") {
    return { ok: false, reason: "risk-suppressed" };
  }
  const key = `${ev.wallet}:${ev.tokenMint || ev.token}`;
  const now = Date.now();
  if (now - (lastAlertAt.get(key) || 0) < COOLDOWN) {
    return { ok: false, reason: "cooldown" };
  }
  lastAlertAt.set(key, now);
  return { ok: true };
}

/** Smart-money alert (tracked-wallet swap via Helius) → signals channel. */
export async function sendAlert(ev: SmartEvent): Promise<void> {
  const g = gate(ev);
  if (!g.ok) {
    console.log(`[alert] skipped (${g.reason}) ${ev.action} ${ev.token}`);
    return;
  }

  const verb = ev.action === "buy" ? "BUY" : "SELL";
  const verbed = ev.action === "buy" ? "bought" : "sold";
  const role = SEG_LABEL[ev.segment];
  // Avoid "Smart money (smart)" when the label just repeats the segment.
  const named =
    ev.label && ev.label.toLowerCase() !== ev.segment ? ` (${ev.label})` : "";

  const metrics = [
    ev.liquidityUsd != null ? `💧 Liq ${fmtUsd(ev.liquidityUsd)}` : null,
    ev.marketCapUsd != null ? `💰 MC ${fmtUsd(ev.marketCapUsd)}` : null,
    fmtAge(ev.tokenAgeMin) ? `🕒 ${fmtAge(ev.tokenAgeMin)}` : null,
  ].filter(Boolean);

  const lines = [
    `${SEG_EMOJI[ev.segment]} <b>SMART MONEY</b> · ${verb}`,
    `<b>$${ev.token}</b> — ${role}${named}`,
    `<code>${ev.walletShort}</code> ${verbed} <b>${fmtUsd(ev.amountUsd)}</b>`,
    metrics.length ? metrics.join("  ·  ") : null,
    riskLine(ev),
    ev.tokenMint ? `<code>${ev.tokenMint}</code>` : null,
    socialLinks(ev.tokenMint, ev.socials),
  ].filter(Boolean) as string[];

  await postToChannel(lines.join("\n"));
}
