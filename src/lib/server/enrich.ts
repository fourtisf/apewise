import type { SmartEvent } from "./store";
import { getTokenMarket } from "./market";
import { getTokenSocials } from "./socials";
import { checkToken } from "./antirug";

/**
 * Fill an event with token symbol, market data (price/mcap/liquidity/age), an
 * anti-rug verdict and the token's community links. Fail-soft — if a source is
 * down the event still flows, just with less context. Mutates and returns it.
 */
export async function enrichEvent(ev: SmartEvent): Promise<SmartEvent> {
  const mint = ev.tokenMint;
  if (!mint) return ev;
  const [market, risk] = await Promise.all([
    getTokenMarket(mint).catch(() => null),
    checkToken(mint).catch(
      () => ({ verdict: "unknown" as const, reasons: [] as string[] }),
    ),
  ]);

  if (market) {
    if (market.symbol) ev.token = market.symbol;
    ev.priceUsd = market.priceUsd;
    ev.marketCapUsd = market.marketCapUsd;
    ev.liquidityUsd = market.liquidityUsd;
    if (market.pairCreatedAt) {
      ev.tokenAgeMin = Math.max(
        0,
        Math.round((Date.now() - market.pairCreatedAt) / 60_000),
      );
    }
  }
  ev.risk = risk;
  // DexScreener socials (from the market call) → pump.fun → Birdeye.
  ev.socials = await getTokenSocials(mint, market?.socials);
  return ev;
}
