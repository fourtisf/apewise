import { getMarketSnapshot } from "./marketLive";
import { getTokenSocials } from "./socials";
import { postToChannel, fmtUsd, socialLinks } from "./alerts";

/**
 * Broadcast notable on-chain activity to the signals channel. Until Helius
 * smart-money tracking is wired, this posts BIG market buys (>= ALERT_MIN_USD)
 * from the live feed. De-duped per trade id; called on an interval by the alert
 * worker (or a cron) hitting /api/alerts/dispatch.
 */
const alerted = new Set<string>();

export async function dispatchAlerts(): Promise<number> {
  const minUsd = Number(process.env.ALERT_MIN_USD) || 250;
  const snap = await getMarketSnapshot();
  if (!snap) return 0;

  const candidates = snap.events
    .filter(
      (e) => e.action === "buy" && e.amountUsd >= minUsd && !alerted.has(e.id),
    )
    .sort((a, b) => b.amountUsd - a.amountUsd)
    .slice(0, 3);

  let posted = 0;
  for (const e of candidates) {
    // Token's own community links (DexScreener → pump.fun → Birdeye, cached).
    const socials = e.tokenMint
      ? await getTokenSocials(e.tokenMint).catch(() => undefined)
      : undefined;
    const lines = [
      `🐋 <b>WHALE BUY</b> · <b>$${e.token}</b>`,
      `<a href="https://solscan.io/account/${e.wallet}">${e.walletShort}</a> bought <b>${fmtUsd(e.amountUsd)}</b>`,
      e.marketCapUsd != null ? `💰 MC ${fmtUsd(e.marketCapUsd)}` : null,
      e.tokenMint ? `<code>${e.tokenMint}</code>` : null,
      socialLinks(e.tokenMint, socials),
    ].filter(Boolean) as string[];
    if (await postToChannel(lines.join("\n"))) {
      alerted.add(e.id);
      posted++;
    }
  }
  if (alerted.size > 3000) alerted.clear();
  return posted;
}
