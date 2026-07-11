import { getMarketSnapshot } from "./marketLive";
import { getTokenSocials } from "./socials";
import { postToChannel, fmtUsd, socialLinks } from "./alerts";

/**
 * Broadcast BIG market buys (>= ALERT_MIN_USD) from the live feed to the signals
 * channel. This was the fallback BEFORE smart-money tracking was wired.
 *
 * OFF by default now: with tracked-wallet alerts live (sendAlert on the ingest
 * paths), running this too posts the SAME token to the channel a second time in
 * a different format — the "double post" users saw. It's also off-brand for a
 * smart-money channel (it broadcasts any random market whale, not a tracked
 * wallet). Set ALERTS_MARKET_FALLBACK=true only if you deliberately want the
 * extra market-whale firehose alongside the tracked-wallet alerts.
 */
const alerted = new Set<string>();

export async function dispatchAlerts(): Promise<number> {
  if (process.env.ALERTS_MARKET_FALLBACK !== "true") return 0;
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
