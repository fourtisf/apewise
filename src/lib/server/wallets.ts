import { promises as fs } from "fs";
import path from "path";

export type Segment = "smart" | "sniper" | "insider" | "kol";

export interface SmartWallet {
  address: string;
  label?: string;
  segment: Segment;
}

const FILE =
  process.env.SMART_WALLETS_FILE ||
  path.join(process.cwd(), "data", "smart-wallets.json");

// Snapshot of the EXACT wallet set registered to the Helius webhook, written by
// scripts/setup-helius-webhook.mjs. When present it's authoritative: the ingest
// route matches every delivered event against the same set that was registered
// (no live-leaderboard drift → no dropped swaps) and pays zero network cost in
// the request path (the live GMGN/Birdeye fetch was making webhook responses slow
// enough for Helius to time out → HTTP 499). Refreshed by the daily cron.
const SNAPSHOT_FILE =
  process.env.TRACKED_WALLETS_FILE ||
  path.join(process.cwd(), "data", "tracked-wallets.json");

let cache: SmartWallet[] | null = null;
let cachedAt = 0;
const TTL = 30_000;

async function readWalletFile(file: string): Promise<SmartWallet[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as SmartWallet[];
    return Array.isArray(parsed) ? parsed.filter((w) => w?.address) : [];
  } catch {
    return [];
  }
}

/**
 * The set of wallets we track. Priority:
 *  1. data/tracked-wallets.json — the snapshot registered to the webhook (if any),
 *  2. else live GMGN/Birdeye auto-sourcing (only before the first registration).
 * The curated manual file (data/smart-wallets.json) is always merged on top so
 * your hand-picked labels/segments win.
 */
export async function getSmartWallets(): Promise<SmartWallet[]> {
  const now = Date.now();
  if (cache && now - cachedAt < TTL) return cache;

  const manual = await readWalletFile(FILE);
  const snapshot = await readWalletFile(SNAPSHOT_FILE);

  let sourced: SmartWallet[];
  if (snapshot.length > 0) {
    // Authoritative, fast, drift-free — matches exactly what the webhook tracks.
    sourced = snapshot;
  } else {
    // No snapshot yet: live auto-source. GMGN (Cloudflare may 403) + Birdeye.
    let gmgn: SmartWallet[] = [];
    if (process.env.USE_GMGN_WALLETS !== "false") {
      try {
        const { getGmgnSmartWallets } = await import("./gmgn");
        gmgn = await getGmgnSmartWallets(50);
      } catch {
        gmgn = [];
      }
    }
    let birdeye: SmartWallet[] = [];
    if (process.env.BIRDEYE_API_KEY) {
      try {
        const { getBirdeyeSmartWallets } = await import("./birdeye");
        const limit = Number(process.env.BIRDEYE_TRACK_LIMIT) || 50;
        birdeye = await getBirdeyeSmartWallets(limit);
      } catch {
        birdeye = [];
      }
    }
    sourced = [...gmgn, ...birdeye];
  }

  const map = new Map<string, SmartWallet>();
  for (const w of sourced) map.set(w.address, w);
  for (const w of manual) map.set(w.address, w); // manual wins (labels/segments)

  cache = [...map.values()];
  cachedAt = now;
  return cache;
}

export async function walletMap(): Promise<Map<string, SmartWallet>> {
  const list = await getSmartWallets();
  return new Map(list.map((w) => [w.address, w]));
}
