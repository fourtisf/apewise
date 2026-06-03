import type { LocaleDict } from "./types";

/** Arabic scaffold (RTL) — high-value strings translated; the rest deep-merges from en.ts.
 *  dir="rtl" is wired automatically for this locale in the strings provider.
 *  TODO: complete translation pass before launching the AR market. */
export const ar: LocaleDict = {
  meta: {
    title: "ApeWise — تابع أذكى الأموال على سولانا",
    description:
      "متعقّب الأموال الذكية لعملات الميم على شبكة سولانا. نقيّم المحافظ الرابحة ونصنّفها (ذكي / قنّاص / مطّلع / مؤثّر) ونرسل تنبيهات تيليجرام فورية بلغتك. مدعوم من Fourtis.",
  },
  nav: {
    links: {
      features: "المزايا",
      how: "كيف يعمل",
      pricing: "الأسعار",
      alerts: "التنبيهات",
    },
    cta: "احصل على وصول مبكر",
  },
  hero: {
    badge: "متعقّب الأموال الذكية على سولانا",
    h1: "تابع أذكى الأموال على سولانا.",
    sub: "يقيّم ApeWise المحافظ الرابحة على السلسلة وينبّهك لحظة شرائها — مصنّفة، ومدمجة بفحص مكافحة الاحتيال، وتصلك مباشرة عبر تيليجرام بلغتك.",
    ctaPrimary: "احصل على وصول مبكر",
    ctaSecondary: "شاهد كيف يعمل",
  },
};
