import { NextResponse } from "next/server";
import { tgSend, fmtUsd } from "@/lib/server/alerts";
import { getMarketSnapshot } from "@/lib/server/marketLive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://apewise.ai";

type TgUpdate = {
  message?: { chat?: { id?: number | string }; text?: string };
};

/** Telegram bot webhook — handles slash commands. Register with
 *  scripts/setup-telegram-bot.mjs (sets the webhook + the command menu). */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    secret &&
    req.headers.get("x-telegram-bot-api-secret-token") !== secret
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text || "").trim();
  if (!chatId || !text.startsWith("/")) return NextResponse.json({ ok: true });

  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (cmd === "/start") {
    await tgSend(
      chatId,
      `👋 <b>ApeWise</b> — the smart-money terminal for Solana memecoins.\n\n` +
        `📊 Live terminal: ${SITE}/terminal\n` +
        `🔔 Signals: @apewisesignals\n\n` +
        `Type /help for commands.`,
    );
  } else if (cmd === "/help") {
    await tgSend(
      chatId,
      `<b>Commands</b>\n` +
        `/terminal — open the live terminal\n` +
        `/top — top trending tokens right now\n` +
        `/status — bot status\n` +
        `/start — about ApeWise`,
    );
  } else if (cmd === "/status") {
    await tgSend(
      chatId,
      `✅ <b>ApeWise bot online.</b>\nTerminal: ${SITE}/terminal\nAlerts post to @apewisesignals.`,
    );
  } else if (cmd === "/terminal") {
    await tgSend(chatId, `📊 Live terminal: ${SITE}/terminal`);
  } else if (cmd === "/top") {
    const snap = await getMarketSnapshot();
    if (!snap || snap.events.length === 0) {
      await tgSend(chatId, `No live data right now. Try ${SITE}/terminal`);
    } else {
      const vol = new Map<string, { v: number; mc?: number }>();
      for (const e of snap.events) {
        const t = vol.get(e.token) || { v: 0, mc: e.marketCapUsd };
        t.v += e.amountUsd;
        vol.set(e.token, t);
      }
      const top = [...vol.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 5);
      const lines = [
        "🔥 <b>Top live tokens</b>",
        ...top.map(
          ([tok, d], i) =>
            `${i + 1}. <b>$${tok}</b>${d.mc != null ? ` · MC ${fmtUsd(d.mc)}` : ""}`,
        ),
        `\n📊 ${SITE}/terminal`,
      ];
      await tgSend(chatId, lines.join("\n"));
    }
  } else {
    await tgSend(chatId, "Unknown command. Try /help");
  }

  return NextResponse.json({ ok: true });
}

export function GET() {
  return NextResponse.json({ ok: true, message: "ApeWise Telegram webhook." });
}
