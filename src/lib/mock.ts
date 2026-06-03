/**
 * MOCK product data for the landing page only.
 * TODO: replace every export here with a real on-chain stream / API before launch.
 */

export type SegmentKey = "smart" | "sniper" | "insider" | "kol";

export interface Segment {
  key: SegmentKey;
  label: string;
  emoji: string;
  color: string; // CSS color (token var)
}

export const SEGMENTS: Record<SegmentKey, Segment> = {
  smart: { key: "smart", label: "Smart", emoji: "🟢", color: "var(--accent)" },
  sniper: { key: "sniper", label: "Sniper", emoji: "⚡", color: "var(--amber)" },
  insider: { key: "insider", label: "Insider", emoji: "🔴", color: "var(--red)" },
  kol: { key: "kol", label: "KOL", emoji: "🎤", color: "var(--accent-2)" },
};

const SEGMENT_KEYS: SegmentKey[] = ["smart", "sniper", "insider", "kol"];
// Weight smart money highest so the feed reads like a curated tracker.
const SEGMENT_WEIGHTS: SegmentKey[] = [
  "smart",
  "smart",
  "smart",
  "sniper",
  "sniper",
  "insider",
  "kol",
];

const TOKENS = [
  "WIF",
  "BONK",
  "POPCAT",
  "MEW",
  "GIGA",
  "PNUT",
  "MOODENG",
  "FWOG",
  "GOAT",
  "ZEREBRO",
  "ai16z",
  "CHILLGUY",
];

const WALLET_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ123456789abcdefghijkmnopqrstuvwxyz";
const SOL_PRICE = 168;

export interface FeedEvent {
  id: string;
  wallet: string;
  segment: SegmentKey;
  action: "buy" | "sell";
  token: string;
  amountSol: number;
  amountUsd: number;
  ts: number;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shortWallet(): string {
  const chunk = (n: number) =>
    Array.from(
      { length: n },
      () => WALLET_CHARS[Math.floor(Math.random() * WALLET_CHARS.length)],
    ).join("");
  return `${chunk(4)}…${chunk(4)}`;
}

let seq = 0;

export function makeFeedEvent(now: number = Date.now()): FeedEvent {
  const segment = pick(SEGMENT_WEIGHTS);
  const action: "buy" | "sell" = Math.random() < 0.74 ? "buy" : "sell";
  const amountSol = Math.round((Math.random() * 190 + 7) * 10) / 10;
  return {
    id: `evt_${now}_${seq++}`,
    wallet: shortWallet(),
    segment,
    action,
    token: pick(TOKENS),
    amountSol,
    amountUsd: Math.round(amountSol * SOL_PRICE),
    ts: now,
  };
}

/** Deterministic-ish seed list so the panel is never empty on first paint. */
export function seedFeed(count = 5): FeedEvent[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const e = makeFeedEvent(now - i * 8000);
    return { ...e, id: `seed_${i}`, segment: SEGMENT_KEYS[i % SEGMENT_KEYS.length] };
  });
}

export function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
}

export function timeAgo(ts: number, now: number = Date.now()): string {
  const s = Math.max(1, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}
