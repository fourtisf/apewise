import type { LocaleDict } from "./types";

/** Russian scaffold — high-value strings translated; the rest deep-merges from en.ts.
 *  TODO: complete translation pass before launching the RU market. */
export const ru: LocaleDict = {
  meta: {
    title: "ApeWise — Следуй за самыми умными деньгами в Solana",
    description:
      "Трекер умных денег для мемкоинов на Solana. Оцениваем прибыльные кошельки, сегментируем (Smart / Sniper / Insider / KOL) и присылаем оповещения в Telegram в реальном времени на вашем языке. При поддержке Fourtis.",
  },
  nav: {
    links: {
      features: "Возможности",
      how: "Как это работает",
      pricing: "Цены",
      alerts: "Оповещения",
    },
    cta: "Ранний доступ",
  },
  hero: {
    badge: "Трекер умных денег на Solana",
    h1: "Следуй за самыми умными деньгами в Solana.",
    sub: "ApeWise оценивает прибыльные ончейн-кошельки и уведомляет вас в момент покупки — с сегментацией, анти-раг проверкой и доставкой прямо в Telegram на вашем языке.",
    ctaPrimary: "Ранний доступ",
    ctaSecondary: "Как это работает",
  },
};
