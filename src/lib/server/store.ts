import { promises as fs } from "fs";
import path from "path";
import type { Segment } from "./wallets";

export type Chain = "solana" | "ethereum" | "bsc" | "base" | "tron" | (string & {});

export interface TokenRisk {
  verdict: "ok" | "caution" | "risk" | "unknown";
  reasons: string[];
  score?: number;
}

/** The signaled token's own community links (from DexScreener). */
export interface TokenSocials {
  website?: string;
  twitter?: string;
  telegram?: string;
}

/** A normalized smart-money event (one tracked-wallet swap), chain-agnostic. */
export interface SmartEvent {
  id: string;
  ts: number; // ms
  chain: Chain;
  wallet: string; // full address
  walletShort: string;
  label?: string;
  segment: Segment;
  action: "buy" | "sell";
  token: string; // symbol or short mint
  tokenMint?: string;
  amountUsd: number;
  amountSol?: number;
  txSig?: string;
  // enrichment
  priceUsd?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  tokenAgeMin?: number;
  risk?: TokenRisk;
  socials?: TokenSocials;
}

const MAX = 2000;
const FILE =
  process.env.EVENTS_FILE || path.join(process.cwd(), "data", "events.jsonl");

// Single PM2 process → a module-level ring buffer shared across requests, with
// JSONL persistence so recent events survive restarts/deploys. `seen` gives
// idempotency: Helius retries (or re-sent webhooks) never double-count.
let buffer: SmartEvent[] = []; // newest first
let seen = new Set<string>();
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const txt = await fs.readFile(FILE, "utf8");
    const parsed = txt
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-MAX)
      .map((l) => JSON.parse(l) as SmartEvent);
    buffer = parsed.reverse();
    seen = new Set(buffer.map((e) => e.id));
  } catch {
    /* no file yet */
  }
}

/** Append events, skipping duplicates. Returns only the freshly-added events. */
export async function addEvents(events: SmartEvent[]): Promise<SmartEvent[]> {
  await ensureLoaded();
  const fresh = events.filter((e) => e.id && !seen.has(e.id));
  if (fresh.length === 0) return [];

  buffer = [...[...fresh].reverse(), ...buffer].slice(0, MAX);
  seen = new Set(buffer.map((e) => e.id)); // keep `seen` bounded to the buffer

  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.appendFile(
      FILE,
      fresh.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    );
  } catch (e) {
    console.error("[store] persist failed:", e);
  }
  return fresh;
}

export async function recentEvents(limit = 40): Promise<SmartEvent[]> {
  await ensureLoaded();
  return buffer.slice(0, limit);
}

export async function allEvents(): Promise<SmartEvent[]> {
  await ensureLoaded();
  return buffer;
}
