#!/usr/bin/env node
/**
 * Register the ApeWise Telegram bot: set the command webhook + the slash-command
 * menu. Run once after deploy (and whenever the URL/secret changes).
 *
 *   TELEGRAM_BOT_TOKEN=... \
 *   NEXT_PUBLIC_SITE_URL=https://apewise.ai \
 *   TELEGRAM_WEBHOOK_SECRET=some-random-string \
 *   node scripts/setup-telegram-bot.mjs
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const site =
  process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "https://apewise.ai";
const url = process.env.TELEGRAM_WEBHOOK_URL || `${site}/api/telegram/webhook`;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const api = (m) => `https://api.telegram.org/bot${token}/${m}`;
const post = (m, body) =>
  fetch(api(m), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const wh = await post("setWebhook", {
  url,
  ...(secret ? { secret_token: secret } : {}),
  allowed_updates: ["message"],
});
console.log("setWebhook →", wh);

const cmds = await post("setMyCommands", {
  commands: [
    { command: "start", description: "About ApeWise" },
    { command: "terminal", description: "Open the live terminal" },
    { command: "top", description: "Top trending tokens" },
    { command: "status", description: "Bot status" },
    { command: "help", description: "Commands" },
  ],
});
console.log("setMyCommands →", cmds);
console.log(`\nWebhook → ${url}`);
