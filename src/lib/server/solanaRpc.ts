import { promises as fs } from "fs";
import path from "path";
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

// Per-wallet cursor (newest processed signature). Module-level AND persisted to
// disk, so a restart/deploy resumes exactly where it left off instead of
// re-baselining every wallet with only a short lookback. `initialized`
// baselines the first sighting so we never backfill a wallet's whole history.
const seen = new Map<string, string>();
const initialized = new Set<string>();
// Rotating window start, so a large wallet set can be covered a slice at a time
// across cycles instead of hammering the RPC with every wallet every cycle.
let pollOffset = 0;

const CURSOR_FILE =
  process.env.RPC_CURSOR_FILE ||
  path.join(process.cwd(), "data", "rpc-cursors.json");
let cursorsLoaded = false;

async function ensureCursorsLoaded(): Promise<void> {
  if (cursorsLoaded) return;
  cursorsLoaded = true;
  try {
    const raw = JSON.parse(await fs.readFile(CURSOR_FILE, "utf8")) as Record<
      string,
      string
    >;
    for (const [w, sig] of Object.entries(raw)) {
      if (typeof sig !== "string" || !sig) continue;
      seen.set(w, sig);
      initialized.add(w); // a persisted cursor means the wallet was baselined
    }
  } catch {
    /* no file yet */
  }
}

async function persistCursors(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CURSOR_FILE), { recursive: true });
    await fs.writeFile(
      CURSOR_FILE,
      JSON.stringify(Object.fromEntries(seen)),
      "utf8",
    );
  } catch (e) {
    console.error("[rpc-poll] cursor persist failed:", e);
  }
}

interface SigInfo {
  signature: string;
  err: unknown;
  blockTime?: number | null;
}

/**
 * All signatures for `wallet` NEWER than the cursor, newest-first — the RPC's
 * `until` param excludes everything at/older than the cursor, so a caught-up
 * wallet costs one cheap empty call. Pages via `before` so an active wallet
 * that produced more than one page since its last slice doesn't silently lose
 * the older ones (the old single-call version capped at `limit` and dropped
 * the rest). Returns null when ANY call fails, so the caller leaves the cursor
 * untouched and retries the whole batch next cycle — a throttled RPC must
 * never translate into permanently skipped swaps.
 */
async function fetchSigsSince(
  wallet: string,
  cursor: string | undefined,
  pageLimit: number,
  callDelay: number,
): Promise<SigInfo[] | null> {
  // First sight has no cursor: one page is the baseline (lookback filters it).
  const maxPages = cursor ? Math.max(1, Number(process.env.RPC_SIG_PAGES) || 3) : 1;
  const out: SigInfo[] = [];
  let before: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const params: Record<string, unknown> = { limit: pageLimit };
    if (cursor) params.until = cursor;
    if (before) params.before = before;
    const page = await rpc<SigInfo[]>("getSignaturesForAddress", [wallet, params]);
    await delay(callDelay);
    if (!page) return null; // RPC failed — retry next cycle, cursor untouched
    out.push(...page);
    if (page.length < pageLimit) return out; // reached the cursor (or history start)
    before = page[page.length - 1].signature;
  }
  // Page cap hit with a full page: even older signatures exist between the
  // cursor and what we fetched. Advancing the cursor drops them — say so
  // instead of losing them silently (bump RPC_SIG_PAGES if this recurs). A
  // full FIRST page with no cursor is just a busy wallet's baseline, not loss.
  if (cursor) {
    console.warn(
      `[rpc-poll] ${wallet.slice(0, 4)}… >${out.length} sigs since cursor; oldest dropped`,
    );
  }
  return out;
}

/**
 * One poll cycle across all tracked wallets. Returns the new swap events found
 * (un-enriched, deduped downstream by txSig). Never throws.
 */
export async function pollTrackedWallets(): Promise<SmartEvent[]> {
  await ensureCursorsLoaded();
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
  //
  // Sort by address first: the merged live list (Birdeye/GMGN caches refresh
  // every few minutes) reshuffles, and rotating by ARRAY POSITION over a
  // reshuffling list skips some wallets and double-polls others. A stable order
  // makes the window walk the whole set deterministically.
  const total = wallets.length;
  if (!total) return [];
  wallets = [...wallets].sort((a, b) => (a.address < b.address ? -1 : 1));
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

  const { getSolPriceUsd } = await import("./market");
  const solPrice = await getSolPriceUsd();
  const callDelay = Number(process.env.RPC_CALL_DELAY_MS) || 150;
  const perWallet = Math.min(Number(process.env.RPC_SIGS_PER_WALLET) || 10, 25);
  const maxAgeMs = (Number(process.env.RPC_MAX_AGE_MIN) || 120) * 60_000;
  // On first sight of a wallet (before its cursor is persisted) look back a
  // short window so recent smart trades surface immediately instead of waiting
  // for a brand-new one. Dedup (addEvents by txSig) keeps re-runs from re-alerting.
  const lookbackMs = (Number(process.env.RPC_LOOKBACK_MIN) || 20) * 60_000;
  const out: SmartEvent[] = [];
  let rpcFailures = 0;

  for (const wallet of wallets) {
    const w = wallet.address;
    const prevSeen = seen.get(w);
    const sigs = await fetchSigsSince(w, prevSeen, perWallet, callDelay);
    if (!sigs) {
      rpcFailures++;
      continue; // RPC failed — cursor untouched, this wallet retries next cycle
    }
    if (!sigs.length) continue; // caught up
    const firstSight = !initialized.has(w);

    // Oldest-first so the feed ordering is chronological within the batch. The
    // cursor only ever advances past signatures we actually PROCESSED: when a
    // getTransaction call fails (free public RPCs 429 constantly) we stop this
    // wallet's batch and resume from the last good signature next cycle. The
    // old code advanced the cursor to `newest` up front, so every throttled
    // fetch was a tracked-wallet swap silently lost forever.
    let cursor = prevSeen;
    for (const s of [...sigs].reverse()) {
      if (s.err) {
        cursor = s.signature; // failed on-chain tx — nothing to fetch
        continue;
      }
      // First sight: only the recent lookback window. Ongoing: cursor bounds it,
      // with a generous staleness guard.
      const ageMs = s.blockTime ? Date.now() - s.blockTime * 1000 : 0;
      if (ageMs > (firstSight ? lookbackMs : maxAgeMs)) {
        cursor = s.signature;
        continue;
      }
      const tx = await rpc<RpcTx>("getTransaction", [
        s.signature,
        { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
      ]);
      await delay(callDelay);
      if (!tx) {
        rpcFailures++;
        break; // throttled — retry from `cursor` next cycle instead of dropping
      }
      cursor = s.signature;
      const ev = parseRpcSwap(tx, wallet, solPrice);
      if (ev) out.push(ev);
    }
    // No cursor movement (e.g. the very first fetch failed) leaves the wallet
    // un-baselined, so the lookback still applies when its slice comes again.
    if (cursor && cursor !== prevSeen) {
      seen.set(w, cursor);
      initialized.add(w);
    }
  }

  // Observability: sustained failures = the RPC is throttling this IP, which
  // starves the whole pipeline. Surface it instead of failing silently.
  if (rpcFailures > 0) {
    console.warn(
      `[rpc-poll] ${rpcFailures} RPC call(s) failed/throttled this cycle (rpc=${activeRpcUrl()})`,
    );
  }
  await persistCursors();

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
