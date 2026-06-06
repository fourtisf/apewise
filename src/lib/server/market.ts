/**
 * Best-effort market data (symbol, price, mcap, liquidity, pair age) + SOL price.
 * Cached and fail-soft — never throws, so ingestion is never blocked by a flaky
 * third-party. Backed by DexScreener (no key) + CoinGecko for SOL price.
 */

const WSOL = "So11111111111111111111111111111111111111112";
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

export function isQuoteMint(mint: string): boolean {
  return mint === WSOL || STABLES.has(mint);
}

export function shortMint(mint: string): string {
  return mint.length > 9 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

async function fetchJson(
  url: string,
  ms = 2500,
  headers?: Record<string, string>,
): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      ...(headers ? { headers } : {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** GeckoTerminal market cap — sanity source when DexScreener returns garbage. */
async function gtMarketCap(mint: string): Promise<number | undefined> {
  const json = (await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}`,
    2500,
    { accept: "application/json" },
  )) as
    | { data?: { attributes?: { market_cap_usd?: string | number; fdv_usd?: string | number } } }
    | null;
  const a = json?.data?.attributes;
  if (!a) return undefined;
  const raw = a.market_cap_usd ?? a.fdv_usd;
  const mc = raw != null ? Number(raw) : NaN;
  return Number.isFinite(mc) && mc > 0 ? mc : undefined;
}

import type { TokenSocials } from "./store";

export interface TokenMarket {
  symbol: string;
  priceUsd?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  pairCreatedAt?: number; // ms
  socials?: TokenSocials;
}

interface DexPair {
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  baseToken?: { address?: string; symbol?: string };
  info?: {
    websites?: { label?: string; url?: string }[];
    socials?: { type?: string; url?: string }[];
  };
}

/** Pull the token's own website / X / Telegram from a DexScreener pair's info. */
function parseSocials(info?: DexPair["info"]): TokenSocials | undefined {
  if (!info) return undefined;
  const out: TokenSocials = {};
  const web = info.websites?.find((w) => w?.url)?.url;
  if (web) out.website = web;
  for (const s of info.socials || []) {
    const url = s?.url;
    if (!url) continue;
    const t = (s.type || "").toLowerCase();
    if (!out.twitter && (t === "twitter" || /(?:twitter\.com|\/\/x\.com)/i.test(url)))
      out.twitter = url;
    else if (!out.telegram && (t === "telegram" || /t\.me\//i.test(url)))
      out.telegram = url;
  }
  return out.website || out.twitter || out.telegram ? out : undefined;
}

const marketCache = new Map<string, { at: number; data: TokenMarket }>();
const MARKET_TTL = 60_000;

export async function getTokenMarket(mint: string): Promise<TokenMarket> {
  const cached = marketCache.get(mint);
  if (cached && Date.now() - cached.at < MARKET_TTL) return cached.data;

  let data: TokenMarket = { symbol: shortMint(mint) };
  const json = (await fetchJson(
    `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
  )) as { pairs?: DexPair[] } | null;

  const pairs = (json?.pairs || []).filter((p) => p.baseToken?.address === mint);
  if (pairs.length) {
    // Most-liquid pair is the canonical reference.
    const best = pairs.reduce((a, b) =>
      (b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a,
    );
    // Prefer the most-liquid pair that actually carries token info/socials.
    const withInfo = pairs.find((p) => p.info) || best;
    data = {
      symbol: best.baseToken?.symbol || shortMint(mint),
      priceUsd: best.priceUsd ? Number(best.priceUsd) : undefined,
      marketCapUsd: best.marketCap ?? best.fdv,
      liquidityUsd: best.liquidity?.usd,
      pairCreatedAt: best.pairCreatedAt,
      socials: parseSocials(withInfo.info),
    };
  }

  // DexScreener occasionally returns an absurd market cap (e.g. BONK as ~$1.9T).
  // Cross-check obviously-broken values (> $50B for a Solana memecoin) against
  // GeckoTerminal; drop the field entirely if it's still nonsense.
  if (data.marketCapUsd != null && data.marketCapUsd > 5e10) {
    const gt = await gtMarketCap(mint).catch(() => undefined);
    data.marketCapUsd = gt != null && gt < 5e10 ? gt : undefined;
  }

  marketCache.set(mint, { at: Date.now(), data });
  return data;
}

export async function resolveSymbol(mint: string): Promise<string> {
  return (await getTokenMarket(mint)).symbol;
}

let solPrice = Number(process.env.SOL_PRICE_USD) || 150;
let solPriceAt = 0;

export async function getSolPriceUsd(): Promise<number> {
  const now = Date.now();
  if (now - solPriceAt < 5 * 60_000) return solPrice;
  solPriceAt = now;
  const data = (await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
  )) as { solana?: { usd?: number } } | null;
  if (data?.solana?.usd && data.solana.usd > 0) solPrice = data.solana.usd;
  return solPrice;
}
