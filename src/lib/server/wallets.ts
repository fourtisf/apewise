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

// The full resolved set the Helius webhook was last registered with (written by
// scripts/setup-helius-webhook.mjs). Reading it guarantees walletMap recognizes
// every tracked wallet, even if a live source (Birdeye/GMGN) is flaky right now.
const TRACKED_FILE =
  process.env.TRACKED_WALLETS_FILE ||
  path.join(process.cwd(), "data", "tracked-wallets.json");

async function readWalletFile(file: string): Promise<SmartWallet[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as SmartWallet[];
    return Array.isArray(parsed) ? parsed.filter((w) => w?.address) : [];
  } catch {
    return [];
  }
}

let cache: SmartWallet[] | null = null;
let cachedAt = 0;
const TTL = 30_000;

/**
 * The curated set of wallets we track (MVP — operator-maintained).
 * data/smart-wallets.json: [{ "address": "...", "label": "Whale 1", "segment": "smart" }]
 * TODO: replace curation with an automated PnL/win-rate scoring engine.
 */
export async function getSmartWallets(): Promise<SmartWallet[]> {
  const now = Date.now();
  if (cache && now - cachedAt < TTL) return cache;

  const [manual, tracked] = await Promise.all([
    readWalletFile(FILE),
    readWalletFile(TRACKED_FILE),
  ]);

  // Auto-source smart wallets from GMGN's leaderboard (set USE_GMGN_WALLETS=false
  // to disable). Fail-soft. Manual entries win, so your custom picks/labels stay.
  let gmgn: SmartWallet[] = [];
  if (process.env.USE_GMGN_WALLETS !== "false") {
    try {
      const { getGmgnSmartWallets } = await import("./gmgn");
      gmgn = await getGmgnSmartWallets(100);
    } catch {
      gmgn = [];
    }
  }

  let birdeye: SmartWallet[] = [];
  if (process.env.BIRDEYE_API_KEY) {
    try {
      const { getBirdeyeSmartWallets } = await import("./birdeye");
      birdeye = await getBirdeyeSmartWallets(100);
    } catch {
      birdeye = [];
    }
  }

  const map = new Map<string, SmartWallet>();
  for (const w of tracked) map.set(w.address, w); // persisted webhook set (baseline)
  for (const w of gmgn) map.set(w.address, w);
  for (const w of birdeye) map.set(w.address, w);
  for (const w of manual) map.set(w.address, w); // manual wins (custom labels)

  cache = [...map.values()];
  cachedAt = now;
  return cache;
}

export async function walletMap(): Promise<Map<string, SmartWallet>> {
  const list = await getSmartWallets();
  return new Map(list.map((w) => [w.address, w]));
}
