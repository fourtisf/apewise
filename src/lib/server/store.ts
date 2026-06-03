import { promises as fs } from "fs";
import path from "path";

/** A normalized smart-money event (one tracked-wallet swap). */
export interface SmartEvent {
  id: string;
  ts: number; // ms
  wallet: string; // full address
  walletShort: string;
  label?: string;
  segment: "smart" | "sniper" | "insider" | "kol";
  action: "buy" | "sell";
  token: string; // symbol or short mint
  tokenMint?: string;
  amountUsd: number;
  amountSol?: number;
  txSig?: string;
}

const MAX = 600;
const FILE =
  process.env.EVENTS_FILE || path.join(process.cwd(), "data", "events.jsonl");

// Single PM2 process → a module-level in-memory ring buffer is shared across
// requests. Persisted to a JSONL file so recent events survive restarts/deploys.
let buffer: SmartEvent[] = []; // newest first
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const txt = await fs.readFile(FILE, "utf8");
    const lines = txt.trim().split("\n").filter(Boolean);
    buffer = lines
      .slice(-MAX)
      .map((l) => JSON.parse(l) as SmartEvent)
      .reverse();
  } catch {
    /* no file yet */
  }
}

export async function addEvents(events: SmartEvent[]): Promise<void> {
  if (events.length === 0) return;
  await ensureLoaded();
  // newest first in memory
  buffer = [...[...events].reverse(), ...buffer].slice(0, MAX);
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.appendFile(
      FILE,
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    );
  } catch (e) {
    console.error("[store] persist failed:", e);
  }
}

export async function recentEvents(limit = 40): Promise<SmartEvent[]> {
  await ensureLoaded();
  return buffer.slice(0, limit);
}

export async function allEvents(): Promise<SmartEvent[]> {
  await ensureLoaded();
  return buffer;
}
