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
  try {
    const txt = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(txt) as SmartWallet[];
    cache = Array.isArray(parsed) ? parsed.filter((w) => w?.address) : [];
  } catch {
    cache = [];
  }
  cachedAt = now;
  return cache;
}

export async function walletMap(): Promise<Map<string, SmartWallet>> {
  const list = await getSmartWallets();
  return new Map(list.map((w) => [w.address, w]));
}
