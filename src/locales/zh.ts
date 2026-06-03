import type { LocaleDict } from "./types";

/** Chinese (Simplified) scaffold — high-value strings translated; the rest deep-merges from en.ts.
 *  TODO: complete translation pass before launching the ZH market. */
export const zh: LocaleDict = {
  meta: {
    title: "ApeWise — 跟随 Solana 上最聪明的资金",
    description:
      "面向 Solana 的 memecoin 聪明钱追踪器。为盈利钱包评分并分类（聪明 / 狙击 / 内部 / KOL），并以你的语言实时推送 Telegram 提醒。由 Fourtis 提供支持。",
  },
  nav: {
    links: {
      features: "功能",
      how: "运作方式",
      pricing: "定价",
      alerts: "提醒",
    },
    cta: "获取抢先体验",
  },
  hero: {
    badge: "Solana 聪明钱追踪器",
    h1: "跟随 Solana 上最聪明的资金。",
    sub: "ApeWise 为盈利的链上钱包评分，并在它们买入的那一刻提醒你——已分类、融合防 rug 检测，并以你的语言通过 Telegram 直达。",
    ctaPrimary: "获取抢先体验",
    ctaSecondary: "了解运作方式",
  },
};
