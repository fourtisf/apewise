import type { SmartEvent } from "./store";
import type { SmartWallet } from "./wallets";
import { isQuoteMint, shortMint } from "./market";
import { parseRpcSwap, type RpcTx } from "./solanaRpc";

/**
 * Minimal shape of a Helius "enhanced" transaction. Real swaps (Jupiter, pump.fun,
 * Photon, …) frequently leave `events.swap` empty, but ALWAYS populate the
 * top-level `accountData` (per-account native + token balance changes) and
 * `feePayer`. So we parse from balance deltas — robust across every DEX/aggregator
 * — and only fall back to `events.swap` if accountData is missing.
 */
interface RawAmount {
  tokenAmount?: string | number;
  decimals?: number;
}
interface TokenLeg {
  userAccount?: string;
  mint?: string;
  rawTokenAmount?: RawAmount;
}
interface NativeLeg {
  account?: string;
  amount?: string | number;
}
interface TokenBalanceChange {
  userAccount?: string;
  tokenAccount?: string;
  mint?: string;
  rawTokenAmount?: RawAmount;
}
interface AccountDatum {
  account?: string;
  nativeBalanceChange?: number;
  tokenBalanceChanges?: TokenBalanceChange[];
}
interface UserTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
}
export interface HeliusTx {
  signature?: string;
  timestamp?: number; // seconds
  type?: string;
  fee?: number;
  feePayer?: string;
  accountData?: AccountDatum[];
  tokenTransfers?: UserTransfer[];
  nativeTransfers?: UserTransfer[];
  events?: {
    swap?: {
      nativeInput?: NativeLeg | null;
      nativeOutput?: NativeLeg | null;
      tokenInputs?: TokenLeg[];
      tokenOutputs?: TokenLeg[];
    };
  };
}

const WSOL = "So11111111111111111111111111111111111111112";

function uiAmount(raw?: RawAmount): number {
  if (!raw) return 0;
  const n = Number(raw.tokenAmount ?? 0);
  const d = Number(raw.decimals ?? 0);
  if (!Number.isFinite(n)) return 0;
  return d > 0 ? n / 10 ** d : n;
}

function shortWallet(addr: string): string {
  return addr.length > 9 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

/**
 * Every account that could be the swapping wallet: feePayer (the signer), every
 * `accountData` account, and both sides of token/native transfers, plus the
 * `events.swap` legs. Matched against the tracked set by the route — relying on
 * `events.swap` alone left `matched=0` because it's empty for most real swaps.
 */
export function involvedAccounts(tx: HeliusTx): string[] {
  const set = new Set<string>();
  if (tx.feePayer) set.add(tx.feePayer); // the swapper signs+pays → check first
  for (const a of tx.accountData || []) if (a.account) set.add(a.account);
  for (const t of [...(tx.tokenTransfers || []), ...(tx.nativeTransfers || [])]) {
    if (t.fromUserAccount) set.add(t.fromUserAccount);
    if (t.toUserAccount) set.add(t.toUserAccount);
  }
  const sw = tx.events?.swap;
  for (const leg of [...(sw?.tokenInputs || []), ...(sw?.tokenOutputs || [])]) {
    if (leg.userAccount) set.add(leg.userAccount);
  }
  if (sw?.nativeInput?.account) set.add(sw.nativeInput.account);
  if (sw?.nativeOutput?.account) set.add(sw.nativeOutput.account);
  return [...set];
}

/** Adapt a Helius enhanced tx to the RpcTx shape so the robust, balance-delta
 *  parseRpcSwap can do the work. The feePayer goes to index 0 so parseRpcSwap's
 *  fee-exclusion (it assumes the fee payer is account 0) lines up. */
function toRpcTx(tx: HeliusTx): RpcTx {
  const ad = tx.accountData || [];
  const fpEntry = tx.feePayer ? ad.find((a) => a.account === tx.feePayer) : undefined;
  const ordered = fpEntry ? [fpEntry, ...ad.filter((a) => a !== fpEntry)] : ad;

  const accountKeys = ordered.map((a) => a.account || "");
  const preBalances = ordered.map(() => 0);
  const postBalances = ordered.map((a) => Number(a.nativeBalanceChange || 0));

  const postTokenBalances = [];
  for (const a of ad) {
    for (const c of a.tokenBalanceChanges || []) {
      if (!c.mint || !c.userAccount) continue;
      postTokenBalances.push({
        owner: c.userAccount,
        mint: c.mint,
        uiTokenAmount: { uiAmount: uiAmount(c.rawTokenAmount) },
      });
    }
  }

  return {
    blockTime: tx.timestamp,
    transaction: { signatures: tx.signature ? [tx.signature] : [], message: { accountKeys } },
    meta: {
      err: null,
      fee: Number(tx.fee || 0),
      preBalances,
      postBalances,
      preTokenBalances: [],
      postTokenBalances,
    },
  };
}

/** Legacy fallback: parse from `events.swap` (only used when accountData is absent). */
function parseFromSwapEvent(
  tx: HeliusTx,
  wallet: SmartWallet,
  solPriceUsd: number,
): SmartEvent | null {
  const swap = tx.events?.swap;
  if (!swap) return null;
  const w = wallet.address;

  const tokenOuts = (swap.tokenOutputs || []).filter((t) => t.userAccount === w);
  const tokenIns = (swap.tokenInputs || []).filter((t) => t.userAccount === w);
  const recv = tokenOuts.find((t) => t.mint && !isQuoteMint(t.mint));
  const sent = tokenIns.find((t) => t.mint && !isQuoteMint(t.mint));

  let action: "buy" | "sell";
  let mint: string | undefined;
  if (recv) {
    action = "buy";
    mint = recv.mint;
  } else if (sent) {
    action = "sell";
    mint = sent.mint;
  } else {
    return null;
  }
  if (!mint) return null;

  const quoteLegs = action === "buy" ? tokenIns : tokenOuts;
  const stableLeg = quoteLegs.find(
    (t) => t.mint && isQuoteMint(t.mint) && t.mint !== WSOL,
  );
  const wsolLeg = quoteLegs.find(
    (t) => t.mint === WSOL && uiAmount(t.rawTokenAmount) > 0,
  );
  const natLamports = Number(
    (action === "buy" ? swap.nativeInput : swap.nativeOutput)?.amount ?? 0,
  );

  let amountUsd = 0;
  let amountSol: number | undefined;
  if (stableLeg && uiAmount(stableLeg.rawTokenAmount) > 0) {
    amountUsd = uiAmount(stableLeg.rawTokenAmount);
  } else {
    amountSol = natLamports > 0 ? natLamports / 1e9 : uiAmount(wsolLeg?.rawTokenAmount);
    amountUsd = Math.round((amountSol || 0) * solPriceUsd);
  }
  if (amountUsd <= 0) return null;

  return {
    id: `${tx.signature || "tx"}_${w.slice(0, 6)}`,
    ts: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    chain: "solana",
    wallet: w,
    walletShort: shortWallet(w),
    label: wallet.label,
    segment: wallet.segment,
    action,
    token: shortMint(mint),
    tokenMint: mint,
    amountUsd: Math.round(amountUsd),
    amountSol,
    txSig: tx.signature,
  };
}

/**
 * Parse one enhanced tx into a (not-yet-enriched) SmartEvent for a tracked wallet,
 * or null if it isn't a parseable swap by that wallet. Primary path is the robust
 * balance-delta parser (shared with the RPC poller); `events.swap` is a fallback.
 * Pure (SOL price passed in) + never throws → unit-testable.
 */
export function parseHeliusTx(
  tx: HeliusTx,
  wallet: SmartWallet,
  solPriceUsd: number,
): SmartEvent | null {
  if (tx.accountData?.length) {
    const ev = parseRpcSwap(toRpcTx(tx), wallet, solPriceUsd);
    if (ev) return ev;
  }
  return parseFromSwapEvent(tx, wallet, solPriceUsd);
}
