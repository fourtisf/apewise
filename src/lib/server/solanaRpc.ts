import type { SmartEvent } from "./store";
import type { SmartWallet } from "./wallets";
// Runtime sibling deps (getSmartWallets, getSolPriceUsd) are imported dynamically
// inside pollTrackedWallets, and the tiny quote/short-mint helpers are inlined
// below, so the pure parser stays free of runtime imports → unit-testable under
// `node --test` (which can't resolve extensionless relative imports).

/**
 * Free, no-Helius fallback: poll tracked wallets via a public Solana RPC and
 * turn their new swaps into normalized SmartEvents. Push-less (we pull), so the
 * terminal/alerts work without a Helius webhook (or its monthly credit cap).
 *
 * Wired as: scripts/rpc-poll-worker.mjs (PM2, interval) → GET /api/ingest/rpc-poll
 * → pollTrackedWallets() → enrich + store + alert (same pipeline as Helius).
 *
 * Fail-soft everywhere: a flaky/limited public RPC never throws here.
 */
const WSOL = "So11111111111111111111111111111111111111112";
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

function shortWallet(a: string): string {
  return a.length > 9 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

function isQuoteMint(mint: string): boolean {
  return mint === WSOL || STABLES.has(mint);
}

function shortMint(mint: string): string {
  return mint.length > 9 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

interface RpcTokenBalance {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { uiAmount?: number | null };
}
export interface RpcTx {
  slot?: number;
  blockTime?: number | null;
  transaction?: {
    signatures?: string[];
    message?: { accountKeys?: Array<string | { pubkey?: string }> };
  };
  meta?: {
    err?: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: RpcTokenBalance[];
    postTokenBalances?: RpcTokenBalance[];
  } | null;
}

/** Sum a wallet's per-mint uiAmount across its token accounts. */
function balByMint(arr: RpcTokenBalance[] | undefined, owner: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const b of arr || []) {
    if (b.owner !== owner || !b.mint) continue;
    m[b.mint] = (m[b.mint] || 0) + Number(b.uiTokenAmount?.uiAmount || 0);
  }
  return m;
}

/**
 * Parse one RPC `getTransaction` (jsonParsed) into a (not-yet-enriched)
 * SmartEvent for `wallet`, or null if it isn't a memecoin swap by that wallet.
 * Pure + deterministic (SOL price is passed in) so it's unit-testable.
 */
export function parseRpcSwap(
  tx: RpcTx,
  wallet: SmartWallet,
  solPriceUsd: number,
): SmartEvent | null {
  const meta = tx?.meta;
  if (!meta || meta.err) return null; // skip failed / metaless txs
  const w = wallet.address;
  const sig = tx.transaction?.signatures?.[0];

  const pre = balByMint(meta.preTokenBalances, w);
  const post = balByMint(meta.postTokenBalances, w);
  const mints = new Set([...Object.keys(pre), ...Object.keys(post)]);

  const delta: Record<string, number> = {};
  for (const m of mints) delta[m] = (post[m] || 0) - (pre[m] || 0);

  // The memecoin = the non-quote mint that moved the most for this wallet.
  let memMint: string | null = null;
  let memDelta = 0;
  for (const m of mints) {
    if (isQuoteMint(m)) continue;
    if (Math.abs(delta[m]) > Math.abs(memDelta)) {
      memMint = m;
      memDelta = delta[m];
    }
  }
  if (!memMint || memDelta === 0) return null; // not a token swap by this wallet
  const action: "buy" | "sell" = memDelta > 0 ? "buy" : "sell";

  // Value: prefer a stablecoin leg (= USD), else native SOL (+WSOL) × price.
  let stableDelta = 0;
  for (const s of STABLES) stableDelta += delta[s] || 0;

  let amountUsd = 0;
  let amountSol: number | undefined;
  if (Math.abs(stableDelta) > 0) {
    amountUsd = Math.round(Math.abs(stableDelta));
  } else {
    const keys = (tx.transaction?.message?.accountKeys || []).map((k) =>
      typeof k === "string" ? k : k?.pubkey || "",
    );
    const idx = keys.indexOf(w);
    let lamports = 0;
    if (idx >= 0 && meta.preBalances && meta.postBalances) {
      lamports = (meta.postBalances[idx] || 0) - (meta.preBalances[idx] || 0);
      // The fee payer (index 0) also pays the tx fee; exclude it from the swap value.
      if (idx === 0 && typeof meta.fee === "number") lamports += meta.fee;
    }
    const nativeSol = Math.abs(lamports) / 1e9;
    const wsolSol = Math.abs(delta[WSOL] || 0);
    amountSol = Math.max(nativeSol, wsolSol);
    amountUsd = Math.round(amountSol * (solPriceUsd || 0));
  }
  if (!(amountUsd > 0)) return null;

  return {
    id: `${sig || "tx"}_${w.slice(0, 6)}`,
    ts: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
    chain: "solana",
    wallet: w,
    walletShort: shortWallet(w),
    label: wallet.label,
    segment: wallet.segment,
    action,
    token: shortMint(memMint), // replaced with the real symbol by enrichEvent
    tokenMint: memMint,
    amountUsd,
    amountSol,
    txSig: sig,
  };
}

/** Read fresh each call so the active RPC always reflects current env. */
export function activeRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(activeRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: T; error?: unknown };
    if (j.error) return null;
    return (j.result ?? null) as T | null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-wallet cursor (newest processed signature). Module-level → persists across
// requests within the single app process. `initialized` baselines the first
// sighting so we never backfill a wallet's whole history on startup.
const seen = new Map<string, string>();
const initialized = new Set<string>();

interface SigInfo {
  signature: string;
  err: unknown;
  blockTime?: number | null;
}

/**
 * One poll cycle across all tracked wallets. Returns the new swap events found
 * (un-enriched, deduped downstream by txSig). Never throws.
 */
export async function pollTrackedWallets(): Promise<SmartEvent[]> {
  let wallets: SmartWallet[] = [];
  try {
    const { getSmartWallets } = await import("./wallets");
    wallets = await getSmartWallets();
  } catch {
    wallets = [];
  }
  // Keep this modest: polling is O(wallets × 1/interval) RPC calls EVERY cycle
  // whether or not anyone trades, so a paid RPC (Helius) burns credits fast on
  // this path. To track many wallets cheaply, use the push webhook
  // (/api/ingest/helius) instead — it only costs you on real swaps.
  const maxWallets = Number(process.env.RPC_MAX_WALLETS) || 60;
  wallets = wallets.slice(0, maxWallets);
  if (!wallets.length) return [];

  const { getSolPriceUsd } = await import("./market");
  const solPrice = await getSolPriceUsd();
  const callDelay = Number(process.env.RPC_CALL_DELAY_MS) || 150;
  const perWallet = Math.min(Number(process.env.RPC_SIGS_PER_WALLET) || 10, 25);
  const maxAgeMs = (Number(process.env.RPC_MAX_AGE_MIN) || 120) * 60_000;
  // On first sight of a wallet (incl. after every app restart) look back a short
  // window so recent smart trades surface immediately instead of waiting for a
  // brand-new one. Dedup (addEvents by txSig) keeps restarts from re-alerting.
  const lookbackMs = (Number(process.env.RPC_LOOKBACK_MIN) || 20) * 60_000;
  const out: SmartEvent[] = [];

  for (const wallet of wallets) {
    const w = wallet.address;
    const sigs = await rpc<SigInfo[]>("getSignaturesForAddress", [
      w,
      { limit: perWallet },
    ]);
    await delay(callDelay);
    if (!sigs || !sigs.length) continue;

    const newest = sigs[0].signature;
    const firstSight = !initialized.has(w);
    initialized.add(w);
    const prevSeen = seen.get(w);

    const fresh: SigInfo[] = [];
    for (const s of sigs) {
      if (prevSeen && s.signature === prevSeen) break; // caught up to cursor
      fresh.push(s);
    }
    seen.set(w, newest);
    if (!fresh.length) continue;

    // Oldest-first so the feed ordering is chronological within the batch.
    for (const s of fresh.reverse()) {
      if (s.err) continue;
      // First sight: only the recent lookback window. Ongoing: cursor bounds it,
      // with a generous staleness guard.
      const ageMs = s.blockTime ? Date.now() - s.blockTime * 1000 : 0;
      if (ageMs > (firstSight ? lookbackMs : maxAgeMs)) continue;
      const tx = await rpc<RpcTx>("getTransaction", [
        s.signature,
        { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
      ]);
      await delay(callDelay);
      if (!tx) continue;
      const ev = parseRpcSwap(tx, wallet, solPrice);
      if (ev) out.push(ev);
    }
  }

  return out;
}

/**
 * Diagnostic (read-only): parse a wallet's most recent transactions WITHOUT
 * touching the poll cursor or ingesting. Lets you confirm real swaps are
 * detected correctly. Exposed via /api/ingest/rpc-poll?debug=<address>.
 */
export async function debugWalletSwaps(
  address: string,
  limit = 5,
): Promise<
  Array<{
    sig?: string;
    minsAgo?: number;
    err: boolean;
    gotTx: boolean;
    parsed: SmartEvent | null;
  }>
> {
  const { getSolPriceUsd } = await import("./market");
  const solPrice = await getSolPriceUsd();
  const sigs = await rpc<SigInfo[]>("getSignaturesForAddress", [
    address,
    { limit: Math.min(Math.max(1, limit), 25) },
  ]);
  const wallet: SmartWallet = { address, segment: "smart", label: "debug" };
  const out: Array<{
    sig?: string;
    minsAgo?: number;
    err: boolean;
    gotTx: boolean;
    parsed: SmartEvent | null;
  }> = [];
  for (const s of sigs || []) {
    await delay(Number(process.env.RPC_CALL_DELAY_MS) || 150);
    const tx = await rpc<RpcTx>("getTransaction", [
      s.signature,
      { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
    ]);
    out.push({
      sig: s.signature?.slice(0, 16),
      minsAgo: s.blockTime
        ? Math.round((Date.now() / 1000 - s.blockTime) / 60)
        : undefined,
      err: !!s.err,
      gotTx: !!tx, // false = RPC throttled/failed (not a parser problem)
      parsed: tx ? parseRpcSwap(tx, wallet, solPrice) : null,
    });
  }
  return out;
}
