/**
 * EN — default dictionary and the canonical shape for every other locale.
 * ALL user-facing copy lives here (no hardcoded strings in components).
 * Other locales are typed as DeepPartial<Strings> and deep-merged over this.
 */
export const en = {
  meta: {
    title: "ApeWise — Follow the smartest money on Solana",
    description:
      "Solana-first memecoin smart-money tracker. Score profitable wallets, segment them (Smart / Sniper / Insider / KOL), fuse anti-rug signals, and get real-time Telegram alerts in your language. Powered by Fourtis.",
  },

  nav: {
    brand: "ApeWise",
    poweredBy: "powered by Fourtis",
    links: {
      features: "Features",
      how: "How it works",
      terminal: "Terminal",
      pricing: "Pricing",
      alerts: "Alerts",
    },
    cta: "Get Early Access",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },

  hero: {
    badge: "Solana-first smart-money tracker",
    statusBeta: "Private beta",
    h1: "Follow the smartest money on Solana.",
    sub: "ApeWise scores profitable on-chain wallets and alerts you the second they ape in — segmented, anti-rug fused, and delivered Telegram-native in your language.",
    ctaPrimary: "Get Early Access",
    ctaSecondary: "See how it works",
    ctaTerminal: "Open the terminal",
    highlights: ["Sub-second Telegram alerts", "Anti-rug fused", "Wallet segments"],
    stats: {
      segments: { value: 4, decimals: 0, suffix: "", label: "Wallet segments" },
      chains: { value: 5, decimals: 0, suffix: "", label: "Chains on the roadmap" },
      languages: { value: 5, decimals: 0, suffix: "", label: "Languages at launch" },
    },
    feed: {
      title: "Smart Money Feed",
      live: "PREVIEW",
      note: "Sample data · private beta",
      buy: "BUY",
      sell: "SELL",
    },
  },

  trust: {
    label: "Incubated & powered by Fourtis",
    chains: ["Solana", "BSC", "Base", "Ethereum", "Tron"],
  },

  problem: {
    kicker: "The problem",
    title: "Memecoins move in seconds. You find out in minutes.",
    body: "By the time a token hits your timeline, the smart money is already taking profit. Generic trackers drown you in noise — every wallet looks the same, alerts arrive late, and rugs slip through. You need to know who is buying, why it matters, and you need to know now.",
    points: [
      {
        title: "Signal buried in noise",
        body: "Thousands of wallets, no way to tell a sniper bot from a proven winner.",
      },
      {
        title: "Alerts that arrive late",
        body: "Email digests and laggy dashboards cost you the entry that mattered.",
      },
      {
        title: "Rugs dressed as moonshots",
        body: "Honeypots and mint authorities hide in plain sight until it's too late.",
      },
    ],
  },

  features: {
    kicker: "What you get",
    title: "An edge built from on-chain truth.",
    sub: "Six systems working together to turn raw Solana activity into decisions you can act on.",
    items: [
      {
        icon: "Crosshair",
        title: "Smart Money Tracking",
        body: "We continuously score wallets on realized PnL, win-rate and consistency — so you follow proven performers, not noise.",
      },
      {
        icon: "Layers",
        title: "Wallet Segments",
        body: "Every wallet is labeled Smart 🟢, Sniper ⚡, Insider 🔴 or KOL 🎤, so you instantly read the intent behind a buy.",
      },
      {
        icon: "TrendingUp",
        title: "Smart-Money Inflows",
        body: "See net inflows from top cohorts per token in real time — conviction you can size, not a single random buy.",
      },
      {
        icon: "ShieldCheck",
        title: "Anti-Rug Fusion",
        body: "Mint authority, LP locks, holder concentration and honeypot checks fused into every alert before it reaches you.",
      },
      {
        icon: "Send",
        title: "Real-time Telegram Alerts",
        body: "Sub-second delivery to Telegram the moment tracked wallets move. No dashboards to babysit, no refresh.",
      },
      {
        icon: "Languages",
        title: "Multi-language",
        body: "Native delivery in English, Indonesian, Russian, Arabic and Chinese — built for emerging markets first.",
      },
    ],
  },

  how: {
    kicker: "How it works",
    title: "From on-chain noise to a clear signal in three steps.",
    steps: [
      {
        title: "We score the wallets",
        body: "ApeWise ingests Solana activity and ranks wallets by realized profit, win-rate and behavior — then segments each one.",
      },
      {
        title: "We fuse the context",
        body: "Each move is enriched with anti-rug checks and smart-money inflow context, so a signal carries conviction, not just an address.",
      },
      {
        title: "You get the alert",
        body: "The instant tracked money buys or sells, you get a Telegram alert in your language — ready to act before the crowd.",
      },
    ],
  },

  why: {
    kicker: "Why ApeWise",
    title: "Not another generic tracker.",
    sub: "The difference is segmentation, delivery and fusion — the things that actually change your entry.",
    columns: {
      feature: "Capability",
      apewise: "ApeWise",
      generic: "Generic trackers",
    },
    rows: [
      { label: "Wallet segmentation (Smart / Sniper / Insider / KOL)", apewise: true, generic: false },
      { label: "Telegram-native, sub-second delivery", apewise: true, generic: false },
      { label: "Your language (EN / ID / RU / AR / ZH)", apewise: true, generic: false },
      { label: "Anti-rug checks fused into every alert", apewise: true, generic: false },
      { label: "Real-time smart-money inflow context", apewise: true, generic: "Partial" },
      { label: "Multi-chain roadmap (SOL · BSC · Base · ETH · Tron)", apewise: true, generic: "Partial" },
    ],
  },

  pricing: {
    kicker: "Pricing",
    title: "Start free. Upgrade when you're winning.",
    sub: "Pay with Telegram Stars — no card, no friction.",
    comingSoon: "Coming soon",
    stars: "Pay with Telegram Stars",
    plans: [
      {
        name: "Free",
        price: "$0",
        period: "forever",
        highlighted: false,
        cta: "Get Early Access",
        features: [
          "Track a starter set of smart wallets",
          "Core Telegram alerts",
          "Basic wallet segments",
          "Community channel access",
        ],
      },
      {
        name: "Pro",
        price: "$29",
        period: "/ month",
        highlighted: true,
        cta: "Join the waitlist",
        features: [
          "Unlimited wallet tracking",
          "All segments + smart-money inflows",
          "Anti-rug fusion on every alert",
          "Priority sub-second delivery",
          "All languages, custom filters",
        ],
      },
    ],
  },

  waitlist: {
    kicker: "Early access",
    title: "Get on the ApeWise waitlist.",
    sub: "Be first when we open the gates. Early members get founding-member pricing and priority alerts.",
    placeholder: "you@email.com",
    cta: "Request access",
    sending: "Sending…",
    success: "You're on the list. Watch your inbox — and Telegram.",
    errorInvalid: "Please enter a valid email address.",
    errorGeneric: "Something went wrong. Please try again.",
    telegramPrompt: "Prefer Telegram? Join",
    telegramCta: "@apewisesignals",
    disclaimer: "No spam. Unsubscribe anytime.",
  },

  footer: {
    tagline: "The smart-money tracker for Solana memecoins. Independent brand, powered by Fourtis.",
    poweredBy: "powered by Fourtis",
    rights: "All rights reserved.",
    columns: {
      product: {
        title: "Product",
        links: {
          features: "Features",
          how: "How it works",
          pricing: "Pricing",
          waitlist: "Early access",
        },
      },
      community: {
        title: "Community",
        links: {
          x: "X / Twitter",
          telegram: "Telegram",
          alerts: "Alerts channel",
        },
      },
      legal: {
        title: "Legal",
        links: {
          privacy: "Privacy",
          terms: "Terms",
        },
      },
    },
  },
};

export type Strings = typeof en;
