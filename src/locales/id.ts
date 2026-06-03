import type { LocaleDict } from "./types";

/** Indonesian scaffold — high-value strings translated; the rest deep-merges from en.ts.
 *  TODO: complete translation pass before launching the ID market. */
export const id: LocaleDict = {
  meta: {
    title: "ApeWise — Ikuti uang terpintar di Solana",
    description:
      "Pelacak smart-money memecoin berbasis Solana. Skor dompet untung, segmentasi (Smart / Sniper / Insider / KOL), dan dapatkan alert Telegram real-time dalam bahasamu. Didukung oleh Fourtis.",
  },
  nav: {
    links: {
      features: "Fitur",
      how: "Cara kerja",
      pricing: "Harga",
      alerts: "Alert",
    },
    cta: "Dapatkan Akses Awal",
  },
  hero: {
    badge: "Pelacak smart-money berbasis Solana",
    h1: "Ikuti uang terpintar di Solana.",
    sub: "ApeWise menilai dompet on-chain yang untung dan memberi tahu Anda saat mereka masuk — tersegmentasi, anti-rug, dan dikirim langsung ke Telegram dalam bahasa Anda.",
    ctaPrimary: "Dapatkan Akses Awal",
    ctaSecondary: "Lihat cara kerjanya",
  },
};
