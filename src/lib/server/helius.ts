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

const WSOL = "So11111111111111111111111111111111111111112";

/**
 * Parse one enhanced tx into a (not-yet-enriched) SmartEvent for a tracked
 * wallet, or null if it isn't a parseable swap by that wallet. Conservative:
 * handles SOL/stable↔token swaps (the memecoin case). Never throws. Symbol /
 * market / risk are filled later by enrichEvent.
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
    amountUsd = Math.round((amountSol || 0) * (await getSolPriceUsd()));
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
    token: shortMint(mint), // replaced with the real symbol by enrichEvent
    tokenMint: mint,
    amountUsd: Math.round(amountUsd),
    amountSol,
    txSig: tx.signature,
  };
}
