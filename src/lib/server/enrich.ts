import type { SmartEvent } from "./store";
import { getTokenMarket } from "./market";
import { checkToken } from "./antirug";

/**
 * Fill an event with token symbol, market data (price/mcap/liquidity/age) and an
 * anti-rug verdict. Fail-soft — if a source is down the event still flows, just
 * with less context. Mutates and returns the event.
 */
export async function enrichEvent(ev: SmartEvent): Promise<SmartEvent> {
  if (!ev.tokenMint) return ev;
  const [market, risk] = await Promise.all([
    getTokenMarket(ev.tokenMint).catch(() => null),
    checkToken(ev.tokenMint).catch(
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
  return ev;
}
