/**
 * Best-effort market data: token symbol + SOL price, both cached and fail-soft.
 * Never throws — falls back to a short mint / a default SOL price so ingestion
 * is never blocked by a flaky third-party.
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

async function fetchJson(url: string, ms = 2500): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const symbolCache = new Map<string, string>();

export async function resolveSymbol(mint: string): Promise<string> {
  if (symbolCache.has(mint)) return symbolCache.get(mint)!;
  let symbol = shortMint(mint);
  const data = (await fetchJson(
    `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
  )) as { pairs?: { baseToken?: { address?: string; symbol?: string } }[] } | null;
  const pair = data?.pairs?.find(
    (p) => p.baseToken?.address === mint && p.baseToken?.symbol,
  );
  if (pair?.baseToken?.symbol) symbol = pair.baseToken.symbol;
  symbolCache.set(mint, symbol);
  return symbol;
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
