import type { TokenRisk } from "./store";
import { getTokenMarket } from "./market";

/**
 * Fail-soft anti-rug check. Combines RugCheck's public report summary with a
 * liquidity floor from DexScreener. Returns "unknown" (never throws) if the
 * sources are unavailable, so a flaky API can't block an alert — it just isn't
 * gated. Cached per mint.
 */
const cache = new Map<string, { at: number; risk: TokenRisk }>();
const TTL = 5 * 60_000;
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD) || 5000;

interface RugSummary {
  score?: number;
  score_normalised?: number;
  risks?: { name?: string; level?: string }[];
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

export async function checkToken(mint: string): Promise<TokenRisk> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.at < TTL) return cached.risk;

  const reasons: string[] = [];
  let verdict: TokenRisk["verdict"] = "unknown";
  let score: number | undefined;

  const summary = (await fetchJson(
    `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`,
  )) as RugSummary | null;

  if (summary) {
    score = summary.score_normalised ?? summary.score;
    const risks = summary.risks || [];
    const danger = risks.filter((r) => (r.level || "").toLowerCase() === "danger");
    const warn = risks.filter((r) => (r.level || "").toLowerCase() === "warn");
    if (danger.length) {
      verdict = "risk";
      reasons.push(...danger.map((r) => r.name || "danger").slice(0, 3));
    } else if (warn.length) {
      verdict = "caution";
      reasons.push(...warn.map((r) => r.name || "warning").slice(0, 3));
    } else {
      verdict = "ok";
    }
  }

  // Liquidity floor — thin liquidity is a rug/exit-scam tell.
  const market = await getTokenMarket(mint);
  if (market.liquidityUsd != null && market.liquidityUsd < MIN_LIQUIDITY_USD) {
    reasons.push(`low liquidity ($${Math.round(market.liquidityUsd)})`);
    if (verdict === "ok" || verdict === "unknown") verdict = "caution";
  }

  const risk: TokenRisk = { verdict, reasons, score };
  cache.set(mint, { at: Date.now(), risk });
  return risk;
}
