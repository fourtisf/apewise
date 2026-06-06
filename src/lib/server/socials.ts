import type { TokenSocials } from "./store";
import { getTokenMarket } from "./market";

/**
 * Resolve a token's community links (website / X / Telegram) with fallbacks, so
 * fresh pump.fun coins that DexScreener hasn't enriched yet still get socials:
 *
 *   1. DexScreener pair `info` (free; already fetched for market data)
 *   2. pump.fun coin metadata (free; best for memecoins)
 *   3. Birdeye token overview `extensions` (needs BIRDEYE_API_KEY)
 *
 * Fail-soft + cached per mint — a blocked/slow source never holds up an alert.
 */
const cache = new Map<string, { at: number; socials?: TokenSocials }>();
const TTL = 10 * 60_000;

function clean(v: unknown, base?: string): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return base ? `${base}${s.replace(/^@/, "")}` : undefined;
}

function merge(into: TokenSocials, from?: TokenSocials): void {
  if (!from) return;
  if (!into.website && from.website) into.website = from.website;
  if (!into.twitter && from.twitter) into.twitter = from.twitter;
  if (!into.telegram && from.telegram) into.telegram = from.telegram;
}

function nonEmpty(s: TokenSocials): TokenSocials | undefined {
  return s.website || s.twitter || s.telegram ? s : undefined;
}

function complete(s: TokenSocials): boolean {
  return Boolean(s.website && s.twitter && s.telegram);
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  ms = 3000,
): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fromPumpFun(mint: string): Promise<TokenSocials | undefined> {
  const j = (await fetchJson(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
  })) as { website?: string; twitter?: string; telegram?: string } | null;
  if (!j) return undefined;
  return nonEmpty({
    website: clean(j.website),
    twitter: clean(j.twitter, "https://x.com/"),
    telegram: clean(j.telegram, "https://t.me/"),
  });
}

async function fromBirdeye(mint: string): Promise<TokenSocials | undefined> {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key) return undefined;
  const j = (await fetchJson(
    `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
    { headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" } },
    7000,
  )) as { data?: { extensions?: Record<string, unknown> } } | null;
  const ext = j?.data?.extensions;
  if (!ext) return undefined;
  return nonEmpty({
    website: clean(ext.website),
    twitter: clean(ext.twitter ?? ext.twitter_url, "https://x.com/"),
    telegram: clean(ext.telegram ?? ext.telegram_url, "https://t.me/"),
  });
}

export async function getTokenSocials(
  mint: string,
  seed?: TokenSocials,
): Promise<TokenSocials | undefined> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.at < TTL) return cached.socials;

  const out: TokenSocials = {};
  // 1) DexScreener — use the seed from an already-fetched market call if given.
  merge(out, seed ?? (await getTokenMarket(mint).catch(() => null))?.socials);
  // 2) pump.fun — fills gaps for memecoins DexScreener hasn't indexed yet.
  if (!complete(out)) merge(out, await fromPumpFun(mint).catch(() => undefined));
  // 3) Birdeye token metadata (only if a key is configured).
  if (!complete(out)) merge(out, await fromBirdeye(mint).catch(() => undefined));

  const socials = nonEmpty(out);
  cache.set(mint, { at: Date.now(), socials });
  return socials;
}
