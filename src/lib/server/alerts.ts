import type { SmartEvent } from "./store";

/**
 * Fire a Telegram alert for a smart-money event to the signals channel.
 * No-ops (and logs) if the bot token / chat id aren't configured, so ingestion
 * never fails because alerting isn't set up yet.
 */
const SEG_EMOJI: Record<SmartEvent["segment"], string> = {
  smart: "🟢",
  sniper: "⚡",
  insider: "🔴",
  kol: "🎤",
};

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n}`;
}

function buyLink(ev: SmartEvent): string | null {
  if (!ev.tokenMint) return null;
  const tmpl = process.env.BUY_LINK_TEMPLATE; // e.g. https://t.me/yourbot?start={mint}
  if (tmpl) return tmpl.replace("{mint}", ev.tokenMint);
  return `https://dexscreener.com/solana/${ev.tokenMint}`;
}

export async function sendAlert(ev: SmartEvent): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_SIGNALS_CHAT_ID;
  if (!token || !chatId) {
    console.log(
      `[alert] (not configured) ${ev.segment} ${ev.action} ${ev.token} ${fmtUsd(ev.amountUsd)}`,
    );
    return;
  }

  const verb = ev.action === "buy" ? "BUY" : "SELL";
  const who = ev.label ? `${ev.label} (${ev.segment})` : `${ev.segment} wallet`;
  const lines = [
    `${SEG_EMOJI[ev.segment]} <b>SMART ${verb}</b> · <b>$${ev.token}</b>`,
    `${who} <code>${ev.walletShort}</code> ${ev.action === "buy" ? "bought" : "sold"} <b>${fmtUsd(ev.amountUsd)}</b>`,
  ];
  if (ev.tokenMint) lines.push(`<code>${ev.tokenMint}</code>`);

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
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines.join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(keyboard ? { reply_markup: keyboard } : {}),
        }),
      },
    );
    if (!res.ok) console.error("[alert] telegram error:", await res.text());
  } catch (e) {
    console.error("[alert] telegram send failed:", e);
  }
}
