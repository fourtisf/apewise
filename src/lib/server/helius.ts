import type { SmartEvent } from "./store";
import type { SmartWallet } from "./wallets";
import { isQuoteMint, getSolPriceUsd, shortMint } from "./market";

/** Minimal shape of a Helius "enhanced" transaction (swap-relevant fields). */
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
/** Top-level transfers — always present; `events.swap` often isn't. */
interface TokenTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  mint?: string;
  tokenAmount?: number | string; // UI amount (decimal-adjusted)
}
interface NativeTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  amount?: number | string; // lamports
}
export interface HeliusTx {
  signature?: string;
  timestamp?: number; // seconds
  type?: string;
  tokenTransfers?: TokenTransfer[];
  nativeTransfers?: NativeTransfer[];
  events?: {
    swap?: {
      nativeInput?: NativeLeg | null;
      nativeOutput?: NativeLeg | null;
      tokenInputs?: TokenLeg[];
      tokenOutputs?: TokenLeg[];
    };
  };
}

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

const WSOL = "So11111111111111111111111111111111111111112";

function mkEvent(
  tx: HeliusTx,
  wallet: SmartWallet,
  action: "buy" | "sell",
  mint: string,
  amountUsd: number,
  amountSol?: number,
): SmartEvent {
  return {
    id: `${tx.signature || "tx"}_${wallet.address.slice(0, 6)}`,
    ts: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    chain: "solana",
    wallet: wallet.address,
    walletShort: shortWallet(wallet.address),
    label: wallet.label,
    segment: wallet.segment,
    action,
    token: shortMint(mint), // replaced with the real symbol by enrichEvent
    tokenMint: mint,
    amountUsd: Math.round(amountUsd),
    amountSol,
    txSig: tx.signature,
  };
}

/** Parse from Helius's normalized `events.swap` (when present). */
async function fromSwapEvent(
  tx: HeliusTx,
  wallet: SmartWallet,
): Promise<SmartEvent | null> {
  const swap = tx.events?.swap;
  if (!swap) return null;
  const w = wallet.address;

  const tokenOuts = (swap.tokenOutputs || []).filter((t) => t.userAccount === w);
  const tokenIns = (swap.tokenInputs || []).filter((t) => t.userAccount === w);

  const recv = tokenOuts.find((t) => t.mint && !isQuoteMint(t.mint)); // bought
  const sent = tokenIns.find((t) => t.mint && !isQuoteMint(t.mint)); // sold

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
    amountSol =
      natLamports > 0 ? natLamports / 1e9 : uiAmount(wsolLeg?.rawTokenAmount);
    amountUsd = Math.round((amountSol || 0) * (await getSolPriceUsd()));
  }
  if (amountUsd <= 0) return null;
  return mkEvent(tx, wallet, action, mint, amountUsd, amountSol);
}

/**
 * Fallback: derive the swap from top-level tokenTransfers / nativeTransfers.
 * Helius leaves `events.swap` null for many DEXes (incl. pump.fun), but the
 * transfers are always present — this is what makes most real swaps parse.
 */
async function fromTransfers(
  tx: HeliusTx,
  wallet: SmartWallet,
): Promise<SmartEvent | null> {
  const w = wallet.address;
  const tt = tx.tokenTransfers || [];
  const nt = tx.nativeTransfers || [];
  if (!tt.length && !nt.length) return null;

  const recv = tt.find(
    (t) => t.toUserAccount === w && t.mint && !isQuoteMint(t.mint),
  );
  const sent = tt.find(
    (t) => t.fromUserAccount === w && t.mint && !isQuoteMint(t.mint),
  );

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

  // Value: a stablecoin leg (= USD) the wallet moved, else the SOL leg × price.
  const stable = tt.find(
    (t) =>
      t.mint &&
      t.mint !== WSOL &&
      isQuoteMint(t.mint) &&
      (t.fromUserAccount === w || t.toUserAccount === w),
  );
  let amountUsd = 0;
  let amountSol: number | undefined;
  if (stable && Number(stable.tokenAmount) > 0) {
    amountUsd = Number(stable.tokenAmount);
  } else {
    const wsol = tt.find(
      (t) => t.mint === WSOL && (t.fromUserAccount === w || t.toUserAccount === w),
    );
    const wsolAmt = wsol ? Number(wsol.tokenAmount) || 0 : 0;
    // Largest native transfer in the swap direction (skip fee/rent dust).
    let lamports = 0;
    for (const n of nt) {
      const a = Number(n.amount) || 0;
      if (action === "buy" && n.fromUserAccount === w) lamports = Math.max(lamports, a);
      if (action === "sell" && n.toUserAccount === w) lamports = Math.max(lamports, a);
    }
    amountSol = Math.max(lamports / 1e9, wsolAmt);
    amountUsd = Math.round(amountSol * (await getSolPriceUsd()));
  }
  if (amountUsd <= 0) return null;
  return mkEvent(tx, wallet, action, mint, amountUsd, amountSol);
}

/**
 * Parse one enhanced tx into a (not-yet-enriched) SmartEvent for a tracked
 * wallet, or null if it isn't a parseable swap by that wallet. Tries Helius's
 * normalized swap event first, then falls back to raw transfers (events.swap is
 * frequently null). Never throws. Symbol/market/risk are filled by enrichEvent.
 */
export async function parseHeliusTx(
  tx: HeliusTx,
  wallet: SmartWallet,
): Promise<SmartEvent | null> {
  return (await fromSwapEvent(tx, wallet)) ?? (await fromTransfers(tx, wallet));
}

/** Every wallet involved in a tx (swap legs + raw transfers) — for matching. */
export function involvedAccounts(tx: HeliusTx): Set<string> {
  const out = new Set<string>();
  const sw = tx.events?.swap;
  for (const leg of [...(sw?.tokenInputs || []), ...(sw?.tokenOutputs || [])]) {
    if (leg.userAccount) out.add(leg.userAccount);
  }
  if (sw?.nativeInput?.account) out.add(sw.nativeInput.account);
  if (sw?.nativeOutput?.account) out.add(sw.nativeOutput.account);
  for (const t of tx.tokenTransfers || []) {
    if (t.fromUserAccount) out.add(t.fromUserAccount);
    if (t.toUserAccount) out.add(t.toUserAccount);
  }
  for (const n of tx.nativeTransfers || []) {
    if (n.fromUserAccount) out.add(n.fromUserAccount);
    if (n.toUserAccount) out.add(n.toUserAccount);
  }
  return out;
}
