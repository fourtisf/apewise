import type { SmartEvent } from "./store";
import type { SmartWallet } from "./wallets";
import {
  isQuoteMint,
  resolveSymbol,
  getSolPriceUsd,
  shortMint,
} from "./market";

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
export interface HeliusTx {
  signature?: string;
  timestamp?: number; // seconds
  type?: string;
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

/**
 * Parse one enhanced tx into a SmartEvent for a tracked wallet, or null if it
 * isn't a parseable swap by that wallet. Conservative: handles SOL/stable↔token
 * swaps (the memecoin case). Never throws.
 */
export async function parseHeliusTx(
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

  // Value: prefer a stablecoin leg (= USD directly), else the SOL leg × price.
  const quoteLegs = action === "buy" ? tokenIns : tokenOuts;
  const stableLeg = quoteLegs.find(
    (t) => t.mint && isQuoteMint(t.mint) && t.mint !== undefined,
  );
  let amountUsd = 0;
  let amountSol: number | undefined;

  const natLamports = Number(
    (action === "buy" ? swap.nativeInput : swap.nativeOutput)?.amount ?? 0,
  );
  const wsolLeg = quoteLegs.find(
    (t) =>
      t.mint === "So11111111111111111111111111111111111111112" &&
      uiAmount(t.rawTokenAmount) > 0,
  );

  if (stableLeg && uiAmount(stableLeg.rawTokenAmount) > 0) {
    amountUsd = uiAmount(stableLeg.rawTokenAmount);
  } else {
    amountSol = natLamports > 0 ? natLamports / 1e9 : uiAmount(wsolLeg?.rawTokenAmount);
    const price = await getSolPriceUsd();
    amountUsd = Math.round((amountSol || 0) * price);
  }

  if (amountUsd <= 0) return null;

  const symbol = await resolveSymbol(mint).catch(() => shortMint(mint!));

  return {
    id: `${tx.signature || "tx"}_${w.slice(0, 6)}`,
    ts: tx.timestamp ? tx.timestamp * 1000 : Date.now(),
    wallet: w,
    walletShort: shortWallet(w),
    label: wallet.label,
    segment: wallet.segment,
    action,
    token: symbol,
    tokenMint: mint,
    amountUsd: Math.round(amountUsd),
    amountSol,
    txSig: tx.signature,
  };
}
