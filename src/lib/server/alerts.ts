import type { SmartEvent } from "./store";

/**
 * Telegram alert for a smart-money event → the signals channel.
 * - No-ops (logs) if the bot token / chat id aren't set.
 * - Rate-limited per wallet+token (anti-spam).
 * - Suppresses high-risk tokens unless ALERT_ON_RISK=true.
 */
const SEG_EMOJI: Record<SmartEvent["segment"], string> = {
  smart: "🟢",
  sniper: "⚡",
  insider: "🔴",
  kol: "🎤",
};

function fmtUsd(n?: number): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

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

function buyLink(ev: SmartEvent): string | null {
  if (!ev.tokenMint) return null;
  const tmpl = process.env.BUY_LINK_TEMPLATE; // e.g. https://t.me/yourbot?start={mint}
  if (tmpl) return tmpl.replace("{mint}", ev.tokenMint);
  return `https://dexscreener.com/solana/${ev.tokenMint}`;
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

export async function sendAlert(ev: SmartEvent): Promise<void> {
  const g = gate(ev);
  if (!g.ok) {
    console.log(`[alert] skipped (${g.reason}) ${ev.action} ${ev.token}`);
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_SIGNALS_CHAT_ID;

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
  ].filter(Boolean);

  if (!token || !chatId) {
    console.log(`[alert] (not configured)\n${lines.join("\n")}`);
    return;
  }

  const buy = buyLink(ev);
  const keyboard = ev.tokenMint
    ? {
        inline_keyboard: [
          [
            ...(buy ? [{ text: "⚡ Buy", url: buy }] : []),
            {
              text: "📊 Chart",
              url: `https://dexscreener.com/solana/${ev.tokenMint}`,
            },
          ],
        ],
      }
    : undefined;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    });
    if (!res.ok) console.error("[alert] telegram error:", await res.text());
  } catch (e) {
    console.error("[alert] telegram send failed:", e);
  }
}
