"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useStrings } from "@/lib/strings";
import {
  SEGMENTS,
  makeFeedEvent,
  seedFeed,
  formatUsd,
  timeAgo,
  type FeedEvent,
} from "@/lib/mock";
import { cn } from "@/lib/cn";

const MAX_ROWS = 6;

/**
 * Live-looking Smart Money Feed. New mock rows slide in on an interval, capped at
 * MAX_ROWS, with ages that tick. Empty on the server to avoid a hydration mismatch
 * from Math.random / Date.now — populated on mount.
 * TODO: replace the generator with a real on-chain (Helius/Geyser) stream.
 */
export function SmartMoneyFeed() {
  const { strings } = useStrings();
  const f = strings.hero.feed;
  const reduce = useReducedMotion();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setEvents(seedFeed(MAX_ROWS));
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const add = setInterval(() => {
      setEvents((prev) => [makeFeedEvent(), ...prev].slice(0, MAX_ROWS));
    }, 2300);
    const clock = setInterval(() => setNow(Date.now()), 2000);
    return () => {
      clearInterval(add);
      clearInterval(clock);
    };
  }, []);

  return (
    <div className="glass overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="relative inline-flex h-2 w-2 items-center justify-center">
            <span className="pulse-dot inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="font-display text-sm font-semibold text-text">
            {f.title}
          </span>
        </div>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-accent">
          {f.live}
        </span>
      </div>

      {/* Rows */}
      <ul className="flex min-h-[19.5rem] flex-col">
        {events.length === 0 &&
          Array.from({ length: MAX_ROWS }).map((_, i) => (
            <li
              key={`skeleton-${i}`}
              className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3 last:border-0"
              aria-hidden
            >
              <div className="h-3 w-28 rounded bg-[var(--surface-2)]" />
              <div className="h-3 w-16 rounded bg-[var(--surface-2)]" />
            </li>
          ))}

        <AnimatePresence initial={false}>
          {events.map((ev) => {
            const seg = SEGMENTS[ev.segment];
            const isBuy = ev.action === "buy";
            return (
              <motion.li
                key={ev.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: -14, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3 transition-colors last:border-0 hover:bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs"
                    style={{
                      background: `color-mix(in srgb, ${seg.color} 16%, transparent)`,
                    }}
                    title={seg.label}
                  >
                    {seg.emoji}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-text">
                        {ev.wallet}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider",
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
                        {isBuy ? f.buy : f.sell}
                      </span>
                    </div>
                    <div
                      className="mt-0.5 text-[0.7rem] capitalize"
                      style={{ color: seg.color }}
                    >
                      {seg.label}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-medium text-text">
                    ${ev.token}
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-2 font-mono text-[0.7rem] text-text-muted">
                    <span>{formatUsd(ev.amountUsd)}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      {now ? timeAgo(ev.ts, now) : "now"}
                    </span>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {/* Honest label: this panel is an illustrative preview, not a live feed yet. */}
      <div className="border-t border-[var(--border)] px-5 py-2.5 text-center font-mono text-[0.6rem] uppercase tracking-[0.18em] text-text-muted">
        {f.note}
      </div>
    </div>
  );
}
