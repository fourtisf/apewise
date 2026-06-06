"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Flame,
  Search,
  Wallet,
  Zap,
} from "lucide-react";
import { BrandLockup } from "@/components/Brand";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { TELEGRAM_ALERTS_URL } from "@/lib/site";
import {
  SEGMENTS,
  seedFeed,
  makeFeedEvent,
  makeTopWallets,
  makeTokenInflows,
  makeKpis,
  formatUsd,
  timeAgo,
  type SegmentKey,
  type FeedEvent,
  type WalletStat,
  type TokenInflow,
  type TerminalKpis,
} from "@/lib/mock";

const FILTERS: { key: SegmentKey | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "smart", label: "Smart" },
  { key: "sniper", label: "Sniper" },
  { key: "insider", label: "Insider" },
  { key: "kol", label: "KOL" },
];

/** Feed row = mock FeedEvent, plus the live-only enrichment fields. */
type Row = FeedEvent & {
  walletAddress?: string;
  chain?: string;
  tokenMint?: string;
  marketCapUsd?: number;
  liquidityUsd?: number;
  riskVerdict?: "ok" | "caution" | "risk" | "unknown";
};

const RISK_DOT: Record<string, string> = {
  ok: "var(--accent)",
  caution: "var(--amber)",
  risk: "var(--red)",
};

function tokenHref(e: Row): string {
  return e.tokenMint
    ? `https://dexscreener.com/${e.chain || "solana"}/${e.tokenMint}`
    : `https://dexscreener.com/?q=${encodeURIComponent(e.token)}`;
}

/**
 * ApeWise Terminal — a premium, live-looking smart-money dashboard.
 * Data is MOCK (sample / private beta). TODO: wire to the real scoring engine
 * + on-chain (Helius/Geyser) stream before public launch.
 */
export function TerminalView() {
  const reduce = useReducedMotion();
  const [feed, setFeed] = useState<Row[]>([]);
  const [wallets, setWallets] = useState<WalletStat[]>([]);
  const [inflows, setInflows] = useState<TokenInflow[]>([]);
  const [kpis, setKpis] = useState<TerminalKpis | null>(null);
  const [now, setNow] = useState(0);
  const [filter, setFilter] = useState<SegmentKey | "all">("all");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<"smart" | "market" | "demo">("demo");
  const [walletsLive, setWalletsLive] = useState(false);
  const [tracked, setTracked] = useState(0);
  const liveRef = useRef(false);

  // Populate on mount (client-only) to avoid a hydration mismatch from Math.random.
  useEffect(() => {
    setFeed(seedFeed(16));
    setWallets(makeTopWallets(6));
    setInflows(makeTokenInflows(6));
    setKpis(makeKpis());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const add = setInterval(() => {
      if (liveRef.current) return; // real data is flowing — pause the demo generator
      setFeed((prev) => [makeFeedEvent(), ...prev].slice(0, 40));
    }, 2600);
    const clock = setInterval(() => setNow(Date.now()), 2000);
    return () => {
      clearInterval(add);
      clearInterval(clock);
    };
  }, []);

  // Poll the engine. When real ingested events exist we switch to LIVE and render
  // them; otherwise we stay in DEMO (mock) so the terminal always looks alive.
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/terminal/feed", { cache: "no-store" });
        if (!res.ok || !active) return;
        const data = await res.json();
        if (!active) return;
        if (data.live && Array.isArray(data.events) && data.events.length) {
          liveRef.current = true;
          setLive(true);
          setSource(data.source === "market" ? "market" : "smart");
          setFeed(data.events as Row[]);
          if (data.kpis) setKpis(data.kpis as TerminalKpis);
          if (typeof data.trackedWallets === "number")
            setTracked(data.trackedWallets);
          if (Array.isArray(data.inflows) && data.inflows.length)
            setInflows(data.inflows as TokenInflow[]);
          if (Array.isArray(data.topWallets) && data.topWallets.length) {
            setWallets(data.topWallets as WalletStat[]);
            setWalletsLive(true);
          } else {
            setWalletsLive(false);
          }
        } else {
          liveRef.current = false;
          setLive(false);
          setSource("demo");
        }
      } catch {
        /* keep demo mode on network errors */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const q = search.trim().toLowerCase();
  const shown = feed
    .filter((e) => filter === "all" || e.segment === filter)
    .filter(
      (e) =>
        !q ||
        e.token.toLowerCase().includes(q) ||
        e.wallet.toLowerCase().includes(q),
    )
    .slice(0, 18);

  const mkt = source === "market";
  const volumeLeaderboard =
    (wallets[0] as { volumeUsd?: number } | undefined)?.volumeUsd != null;
  const kpiCards = kpis
    ? [
        {
          icon: Activity,
          label: mkt ? "Market volume · 24h" : "Smart-money volume · 24h",
          value: formatUsd(kpis.volumeUsd),
          sub: undefined as string | undefined,
        },
        {
          icon: Wallet,
          label: mkt ? "Active traders" : "Active smart wallets",
          value: kpis.activeWallets.toLocaleString("en-US"),
          // Active = wallets that actually traded in 24h; we watch many more.
          sub:
            !mkt && tracked
              ? `of ${tracked.toLocaleString("en-US")} tracked`
              : undefined,
        },
        {
          icon: Zap,
          label: mkt ? "Trades · 24h" : "Signals fired · 24h",
          value: kpis.signals24h.toLocaleString("en-US"),
          sub: undefined as string | undefined,
        },
        {
          icon: Flame,
          label: "Top token · 1h",
          value: `$${kpis.topToken}`,
          sub: undefined as string | undefined,
        },
      ]
    : [];

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="-m-1 rounded-lg p-1"
              aria-label="ApeWise home"
            >
              <BrandLockup />
            </Link>
            <span className="hidden rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-muted sm:inline">
              Terminal
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-muted md:inline-flex">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="pulse-dot inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              {source === "smart"
                ? "Live · smart money"
                : source === "market"
                  ? "Live · market"
                  : "Sample data · private beta"}
            </span>
            <Button href="/#waitlist" size="sm">
              Get live access
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6">
        {/* Search (decorative preview) */}
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_60%,transparent)] px-4 py-2.5 focus-within:border-[var(--border-strong)]">
          <Search className="h-4 w-4 text-text-muted" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a token or wallet…"
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
            aria-label="Search the feed"
          />
        </div>

        {source === "market" && (
          <div className="mb-5 rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_45%,transparent)] px-4 py-2.5 text-xs text-text-muted">
            Showing <span className="text-text">live Solana market trades</span> —
            connect tracked wallets to score smart money &amp; fire alerts.
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpiCards.length === 0
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="glass h-[5.75rem] animate-pulse" />
              ))
            : kpiCards.map((k) => (
                <div key={k.label} className="glass p-4">
                  <div className="flex items-center gap-2 text-text-muted">
                    <k.icon className="h-3.5 w-3.5 text-accent" aria-hidden />
                    <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em]">
                      {k.label}
                    </span>
                  </div>
                  <div className="mt-2 font-display text-2xl font-semibold tabular-nums text-text">
                    {k.value}
                  </div>
                  {k.sub && (
                    <div className="mt-0.5 font-mono text-[0.58rem] text-text-muted">
                      {k.sub}
                    </div>
                  )}
                </div>
              ))}
        </div>

        {/* Main grid */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.7fr_1fr]">
          {/* Live feed */}
          <section className="glass overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="relative inline-flex h-2 w-2">
                  <span className="pulse-dot inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                <span className="font-display text-sm font-semibold text-text">
                  {source === "market" ? "Live Solana Trades" : "Live Smart Money Feed"}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.16em]",
                    live
                      ? "border-[var(--border-strong)] text-accent"
                      : "border-[var(--border)] text-text-muted",
                  )}
                >
                  {live ? "Live" : "Demo"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-wider transition-colors",
                      filter === f.key
                        ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-text"
                        : "border-[var(--border)] text-text-muted hover:text-text",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Column header */}
            <div className="hidden grid-cols-[1.4fr_auto_0.8fr_0.9fr_0.6fr] gap-3 border-b border-[var(--border)] px-5 py-2 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-text-muted sm:grid">
              <span>Wallet</span>
              <span>Action</span>
              <span>Token</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Age</span>
            </div>

            <ul className="min-h-[28rem]">
              {feed.length === 0 &&
                Array.from({ length: 8 }).map((_, i) => (
                  <li
                    key={`s-${i}`}
                    className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5"
                    aria-hidden
                  >
                    <div className="h-3 w-32 rounded bg-[var(--surface-2)]" />
                    <div className="h-3 w-16 rounded bg-[var(--surface-2)]" />
                  </li>
                ))}

              <AnimatePresence initial={false}>
                {shown.map((ev) => {
                  const seg = SEGMENTS[ev.segment];
                  const isBuy = ev.action === "buy";
                  return (
                    <motion.li
                      key={ev.id}
                      layout={!reduce}
                      initial={reduce ? false : { opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[var(--border)] px-5 py-3 transition-colors last:border-0 hover:bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)] sm:grid-cols-[1.4fr_auto_0.8fr_0.9fr_0.6fr]"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs"
                          style={{
                            background:
                              source === "market"
                                ? "var(--surface-2)"
                                : `color-mix(in srgb, ${seg.color} 16%, transparent)`,
                          }}
                          title={source === "market" ? "market trade" : seg.label}
                        >
                          {source === "market" ? "•" : seg.emoji}
                        </span>
                        <div className="min-w-0">
                          {ev.walletAddress ? (
                            <a
                              href={`https://solscan.io/account/${ev.walletAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-sm text-text transition-colors hover:text-accent"
                              title="View wallet on Solscan"
                            >
                              {ev.wallet}
                            </a>
                          ) : (
                            <div className="font-mono text-sm text-text">
                              {ev.wallet}
                            </div>
                          )}
                          <div
                            className="text-[0.7rem]"
                            style={{
                              color:
                                source === "market"
                                  ? "var(--text-muted)"
                                  : seg.color,
                            }}
                          >
                            {source === "market" ? "trade" : seg.label}
                          </div>
                        </div>
                      </div>

                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 justify-self-start rounded-md px-1.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase",
                          isBuy
                            ? "bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent"
                            : "bg-[color:color-mix(in_srgb,var(--red)_16%,transparent)] text-red",
                        )}
                      >
                        {isBuy ? (
                          <ArrowDownLeft className="h-3 w-3" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3" />
                        )}
                        {isBuy ? "Buy" : "Sell"}
                      </span>

                      <div className="hidden min-w-0 sm:block">
                        <a
                          href={tokenHref(ev)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-sm text-text transition-colors hover:text-accent"
                        >
                          {ev.riskVerdict && ev.riskVerdict !== "unknown" && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: RISK_DOT[ev.riskVerdict] }}
                              title={`Anti-rug: ${ev.riskVerdict}`}
                            />
                          )}
                          ${ev.token}
                        </a>
                        {ev.marketCapUsd != null && (
                          <div className="font-mono text-[0.6rem] text-text-muted">
                            MC {formatUsd(ev.marketCapUsd)}
                          </div>
                        )}
                      </div>
                      <span className="hidden text-right font-mono text-sm tabular-nums text-text sm:block">
                        {formatUsd(ev.amountUsd)}
                      </span>
                      <span className="hidden text-right font-mono text-[0.7rem] tabular-nums text-text-muted sm:block">
                        {now ? timeAgo(ev.ts, now) : "now"}
                      </span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>

              {feed.length > 0 && shown.length === 0 && (
                <li className="px-5 py-12 text-center text-sm text-text-muted">
                  No activity matches your search/filter.
                </li>
              )}
            </ul>
          </section>

          {/* Right rail */}
          <aside className="flex flex-col gap-4">
            {/* Top wallets */}
            <div className="glass overflow-hidden">
              <div className="border-b border-[var(--border)] px-5 py-3.5">
                <span className="font-display text-sm font-semibold text-text">
                  {volumeLeaderboard ? "Top Traders · live" : "Top Smart Wallets · 7d"}
                </span>
              </div>
              {!walletsLive && source === "market" ? (
                <div className="px-5 py-8 text-center text-sm leading-relaxed text-text-muted">
                  Smart-wallet leaderboard unavailable — GMGN may be blocking the
                  request. Connect Helius to rank tracked wallets here.
                </div>
              ) : (
              <ul>
                {wallets.length === 0 &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <li key={`w-${i}`} className="px-5 py-3.5" aria-hidden>
                      <div className="h-3 w-full rounded bg-[var(--surface-2)]" />
                    </li>
                  ))}
                {wallets.map((w, i) => {
                  const seg = SEGMENTS[w.segment];
                  const vol = (w as { volumeUsd?: number }).volumeUsd;
                  return (
                    <li
                      key={w.wallet}
                      className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3 transition-colors last:border-0 hover:bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="w-4 text-center font-mono text-xs text-text-muted">
                          {i + 1}
                        </span>
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: mkt ? "var(--text-muted)" : seg.color }}
                          title={seg.label}
                        />
                        <div className="min-w-0">
                          <div className="font-mono text-sm text-text">
                            {w.wallet}
                          </div>
                          <div className="font-mono text-[0.65rem] text-text-muted">
                            {vol != null
                              ? `${w.trades} trades · live`
                              : w.winRate > 0
                                ? `${w.winRate}% win · ${w.trades} trades`
                                : `${w.trades} trades · 7d`}
                          </div>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-sm font-medium tabular-nums",
                          vol != null ? "text-text" : "text-accent",
                        )}
                      >
                        {vol != null
                          ? formatUsd(vol)
                          : `+${formatUsd(w.pnlUsd)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              )}
            </div>

            {/* Token inflows */}
            <div className="glass overflow-hidden">
              <div className="border-b border-[var(--border)] px-5 py-3.5">
                <span className="font-display text-sm font-semibold text-text">
                  {mkt ? "Token Net Flow · live" : "Smart-Money Inflows · 1h"}
                </span>
              </div>
              <ul>
                {inflows.length === 0 &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <li key={`i-${i}`} className="px-5 py-3.5" aria-hidden>
                      <div className="h-3 w-full rounded bg-[var(--surface-2)]" />
                    </li>
                  ))}
                {inflows.map((t) => {
                  const pct = Math.max(6, Math.min(100, t.changePct));
                  const positive = t.netInflowUsd >= 0;
                  return (
                    <li
                      key={t.token}
                      className="border-b border-[var(--border)] px-5 py-3 transition-colors last:border-0 hover:bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm text-text">
                          ${t.token}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-sm tabular-nums",
                            positive ? "text-text" : "text-red",
                          )}
                        >
                          {positive ? "+" : "−"}
                          {formatUsd(Math.abs(t.netInflowUsd))}
                        </span>
                      </div>
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                        <div
                          className="h-full rounded-full bg-accent/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1.5 font-mono text-[0.65rem] text-text-muted">
                        {t.wallets} {mkt ? "traders" : "smart wallets"} ·{" "}
                        {t.changePct}% buys
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </div>

        {/* Bottom CTA */}
        <div className="glass mt-4 flex flex-col items-center justify-between gap-4 px-6 py-5 text-center sm:flex-row sm:text-left">
          <div>
            <div className="font-display text-base font-semibold text-text">
              This is a sample of the ApeWise terminal.
            </div>
            <div className="mt-1 text-sm text-text-muted">
              Live wallet scoring, anti-rug alerts and inflows ship to early
              members first.
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <Button href="/#waitlist" size="md">
              Get live access
            </Button>
            <Button href={TELEGRAM_ALERTS_URL} variant="secondary" size="md">
              Join signals
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
