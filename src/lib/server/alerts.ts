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

function fmtAge(min?: number): string | null {
  if (min == null) return null;
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

function riskLine(ev: SmartEvent): string | null {
  const r = ev.risk;
  if (!r || r.verdict === "unknown") return null;
  if (r.verdict === "ok") return "🛡 Anti-rug: clean";
  if (r.verdict === "caution")
    return `⚠️ Caution: ${r.reasons.slice(0, 2).join(", ") || "checks flagged"}`;
  return `🚨 High risk: ${r.reasons.slice(0, 2).join(", ") || "checks flagged"}`;
}

function buyLink(mint: string): string {
  const tmpl = process.env.BUY_LINK_TEMPLATE;
  return tmpl
    ? tmpl.replace("{mint}", mint)
    : `https://dexscreener.com/solana/${mint}`;
}

export function chartKeyboard(mint?: string) {
  if (!mint) return undefined;
  return {
    inline_keyboard: [
      [
        { text: "⚡ Buy", url: buyLink(mint) },
        { text: "📊 Chart", url: `https://dexscreener.com/solana/${mint}` },
      ],
    ],
  };
}

// Per wallet+token cooldown (anti-spam).
const lastAlertAt = new Map<string, number>();
const COOLDOWN = (Number(process.env.ALERT_COOLDOWN_SEC) || 60) * 1000;

/**
 * Only alert on swaps that just happened. The RPC poll can surface old on-chain
 * txs (e.g. a wallet's most-recent activity, or after a restart/lookback); posting
 * those would make the channel look stale ("not realtime"). A swap older than
 * ALERT_MAX_AGE_MIN (default 30) is stored/scored but never broadcast.
 */
export function withinAlertWindow(ts?: number, now = Date.now()): boolean {
  if (!ts) return true; // unknown time → don't suppress (Helius webhooks are realtime)
  const maxAgeMin = Number(process.env.ALERT_MAX_AGE_MIN);
  const maxAgeMs = (Number.isFinite(maxAgeMin) && maxAgeMin > 0 ? maxAgeMin : 30) * 60_000;
  return now - ts <= maxAgeMs;
}

function gate(ev: SmartEvent): { ok: boolean; reason?: string } {
  if (ev.risk?.verdict === "risk" && process.env.ALERT_ON_RISK !== "true") {
    return { ok: false, reason: "risk-suppressed" };
  }
  if (!withinAlertWindow(ev.ts)) {
    return { ok: false, reason: "stale" };
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
  const who = ev.label ? `${ev.label} (${ev.segment})` : `${ev.segment} wallet`;
  const metrics = [
    ev.liquidityUsd != null ? `💧 Liq ${fmtUsd(ev.liquidityUsd)}` : null,
    ev.marketCapUsd != null ? `🧢 MC ${fmtUsd(ev.marketCapUsd)}` : null,
    fmtAge(ev.tokenAgeMin) ? `⏱ ${fmtAge(ev.tokenAgeMin)}` : null,
  ].filter(Boolean);

  const lines = [
    `${SEG_EMOJI[ev.segment]} <b>SMART ${verb}</b> · <b>$${ev.token}</b>`,
    `${who} <code>${ev.walletShort}</code> ${ev.action === "buy" ? "bought" : "sold"} <b>${fmtUsd(ev.amountUsd)}</b>`,
    metrics.length ? metrics.join("  ·  ") : null,
    riskLine(ev),
    ev.tokenMint ? `<code>${ev.tokenMint}</code>` : null,
  ].filter(Boolean) as string[];

  await postToChannel(lines.join("\n"), chartKeyboard(ev.tokenMint));
}
