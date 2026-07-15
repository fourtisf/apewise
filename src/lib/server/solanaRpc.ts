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

// Keyless public endpoints used when the operator configured nothing. Several
// by default, because mainnet-beta aggressively throttles datacenter/VPS IPs —
// with a single URL there is nowhere to rotate to and polling starves.
const DEFAULT_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
];

/**
 * RPC endpoints, in preference order. SOLANA_RPC_URLS (comma list) enables
 * automatic failover: when a poll cycle is mostly throttled (public
 * mainnet-beta aggressively 429s datacenter IPs — the classic way this
 * pipeline silently dies), we rotate to the next endpoint instead of
 * returning [] forever. SOLANA_RPC_URL pins a single endpoint (no rotation);
 * with neither set, a built-in keyless trio is used.
 */
function rpcUrls(): string[] {
  const multi = (process.env.SOLANA_RPC_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi.length) return multi;
  if (process.env.SOLANA_RPC_URL) return [process.env.SOLANA_RPC_URL];
  return DEFAULT_RPCS;
}

let rpcIdx = 0;
// Grows ×2 per throttled cycle (fail ratio > 25%), shrinks ÷2 per clean cycle.
let throttleMultiplier = 1;

/** Read fresh each call so the active RPC always reflects current env. */
export function activeRpcUrl(): string {
  const urls = rpcUrls();
  return urls[rpcIdx % urls.length];
}

/** Advance to the next configured endpoint (no-op with a single URL). */
function rotateRpc(): void {
  const urls = rpcUrls();
  if (urls.length < 2) return;
  rpcIdx = (rpcIdx + 1) % urls.length;
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
// Rotating window start, so a large wallet set can be covered a slice at a time
// across cycles instead of hammering the RPC with every wallet every cycle.
let pollOffset = 0;

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
  // Cost is O(window × 1/interval) RPC calls EVERY cycle whether or not anyone
  // trades. To track a LARGE wallet set cheaply we poll a rotating window each
  // cycle (RPC_MAX_WALLETS wallets), advancing the start every cycle so the
  // whole set is covered over a few cycles — full coverage, bounded RPC load.
  // Each wallet keeps its own cursor, so a swap surfaces the next time its slice
  // comes up (typically within a couple of minutes). Set RPC_ROTATE_WALLETS=false
  // to always poll the first RPC_MAX_WALLETS instead.
  const total = wallets.length;
  if (!total) return [];
  const windowSize = Math.max(1, Number(process.env.RPC_MAX_WALLETS) || 60);
  if (process.env.RPC_ROTATE_WALLETS !== "false" && total > windowSize) {
    const start = pollOffset % total;
    const window: SmartWallet[] = [];
    for (let i = 0; i < windowSize; i++) window.push(wallets[(start + i) % total]);
    wallets = window;
    pollOffset = (pollOffset + windowSize) % total;
  } else {
    wallets = wallets.slice(0, windowSize);
  }

  // Round-robin: advance one endpoint per cycle so each provider only sees
  // 1/N of the poll traffic — N endpoints ≈ N× the free-tier headroom, which
  // is what actually keeps a keyless/free setup under rate limits. The
  // throttle rotation below still applies on top. RPC_ROUND_ROBIN=false pins
  // each cycle to the current endpoint (pure failover behavior).
  if (process.env.RPC_ROUND_ROBIN !== "false") rotateRpc();

  const { getSolPriceUsd } = await import("./market");
  const solPrice = await getSolPriceUsd();
  // Adaptive spacing: while the endpoint throttles us, widen the gap between
  // calls (up to 8×) instead of hammering at full speed — hammering keeps the
  // IP throttled forever. A clean cycle narrows it back down.
  const callDelay =
    (Number(process.env.RPC_CALL_DELAY_MS) || 150) * throttleMultiplier;
  const perWallet = Math.min(Number(process.env.RPC_SIGS_PER_WALLET) || 10, 25);
  const maxAgeMs = (Number(process.env.RPC_MAX_AGE_MIN) || 120) * 60_000;
  // On first sight of a wallet (incl. after every app restart) look back a short
  // window so recent smart trades surface immediately instead of waiting for a
  // brand-new one. Dedup (addEvents by txSig) keeps restarts from re-alerting.
  const lookbackMs = (Number(process.env.RPC_LOOKBACK_MIN) || 20) * 60_000;
  const out: SmartEvent[] = [];

  // Cycle stats: when EVERY call in a cycle fails the endpoint is throttled or
  // down — rotate to the next configured RPC and surface it via /api/health
  // instead of silently returning [] forever (which reads as "bot stopped").
  let calls = 0;
  let fails = 0;
  const trackedRpc = async <T>(
    method: string,
    params: unknown[],
  ): Promise<T | null> => {
    calls++;
    const r = await rpc<T>(method, params);
    if (r === null) fails++;
    return r;
  };

  for (const wallet of wallets) {
    const w = wallet.address;
    const sigs = await trackedRpc<SigInfo[]>("getSignaturesForAddress", [
      w,
      { limit: perWallet },
    ]);
    await delay(callDelay);
    if (!sigs || !sigs.length) continue;

    const firstSight = !initialized.has(w);
    const prevSeen = seen.get(w);

    const fresh: SigInfo[] = [];
    for (const s of sigs) {
      if (prevSeen && s.signature === prevSeen) break; // caught up to cursor
      fresh.push(s);
    }
    if (!fresh.length) continue;

    // Oldest-first so the feed ordering is chronological within the batch.
    // Advance the cursor only PAST signatures we actually processed: a failed
    // getTransaction (throttled RPC) stops this wallet's scan so the same
    // signature is retried next cycle. The old code jumped the cursor to
    // `newest` up front, so every fetch failure permanently skipped that swap —
    // under sustained throttling that silently dropped ALL events. A signature
    // that keeps failing ages past RPC_MAX_AGE_MIN and is skipped, so one
    // poison tx can't wedge the wallet forever.
    let cursor = prevSeen;
    for (const s of fresh.reverse()) {
      // First sight: only the recent lookback window. Ongoing: cursor bounds it,
      // with a generous staleness guard.
      const ageMs = s.blockTime ? Date.now() - s.blockTime * 1000 : 0;
      if (s.err || ageMs > (firstSight ? lookbackMs : maxAgeMs)) {
        cursor = s.signature; // nothing to fetch — safe to move past it
        continue;
      }
      const tx = await trackedRpc<RpcTx>("getTransaction", [
        s.signature,
        { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
      ]);
      await delay(callDelay);
      if (!tx) break; // fetch failed — retry from this signature next cycle
      cursor = s.signature;
      const ev = parseRpcSwap(tx, wallet, solPrice);
      if (ev) out.push(ev);
    }
    // Commit first-sight status together with the cursor: if the very first
    // fetch failed (cursor never set), the wallet stays "first sight" so the
    // next cycle still uses the tight lookback window instead of silently
    // widening the backfill to RPC_MAX_AGE_MIN.
    if (cursor) {
      seen.set(w, cursor);
      initialized.add(w);
    }
  }

  // Throttle response — ONE aggregated line per bad cycle (never per wallet):
  // fail ratio > 25% widens the call spacing; > 50% also rotates endpoints.
  const failRatio = calls > 0 ? fails / calls : 0;
  if (failRatio > 0.25) {
    throttleMultiplier = Math.min(throttleMultiplier * 2, 8);
    console.warn(
      `[rpc-poll] throttled: ${fails}/${calls} calls failed via ${activeRpcUrl()} — ` +
        `spacing ×${throttleMultiplier}${failRatio >= 0.5 ? ", rotating endpoint" : ""}`,
    );
  } else if (calls > 0 && fails === 0 && throttleMultiplier > 1) {
    throttleMultiplier = Math.max(1, Math.floor(throttleMultiplier / 2));
  }
  // Heartbeat for /api/health (dynamic import keeps the pure parser testable
  // under node --test, same as ./wallets and ./market above). Fail-soft.
  try {
    const { noteRpcCycle, noteWalletCount } = await import("./health");
    noteRpcCycle({ url: activeRpcUrl(), calls, fails });
    noteWalletCount(total);
  } catch {
    /* health module unavailable (unit tests) */
  }
  if (failRatio >= 0.5) rotateRpc();

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
