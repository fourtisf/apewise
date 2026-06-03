/**
 * Central site constants — single source of truth for URLs, handles and brand
 * metadata reused across SEO, JSON-LD, sitemap and the footer.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://apewise.ai";

export const SITE_NAME = "ApeWise";
export const SITE_TAGLINE = "Follow the smartest money on Solana.";
export const SITE_DESCRIPTION =
  "ApeWise is a Solana-first memecoin smart-money tracker. We score profitable on-chain wallets and alert you in real time — segmented Smart, Sniper, Insider and KOL flows, anti-rug fused, delivered Telegram-native in your language. Powered by Fourtis.";

// Social / community
export const X_HANDLE = "apewiseai";
export const X_URL = "https://x.com/apewiseai";
export const TELEGRAM_MAIN = "https://t.me/apewiseai";
export const TELEGRAM_ALERTS_HANDLE = "apewisesignals";
export const TELEGRAM_ALERTS_URL = "https://t.me/apewisesignals";

export const FOURTIS_URL = "https://fourtis.io";
