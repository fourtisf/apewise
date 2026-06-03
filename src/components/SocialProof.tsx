"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { TELEGRAM_ALERTS_URL } from "@/lib/site";

const STACK = ["Solana", "Helius", "DexScreener", "RugCheck", "Telegram"];

/**
 * Trust band: real demand (live waitlist count) + the infrastructure ApeWise is
 * built on. Honest — the count is the true signup total; hidden until > 0.
 */
export function SocialProof() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/waitlist/count", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCount(typeof d.count === "number" ? d.count : 0))
      .catch(() => setCount(0));
  }, []);

  return (
    <section className="border-y border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_28%,transparent)]">
      <div className="container-content py-14">
        <Reveal>
          <div className="flex flex-col items-center gap-6 text-center">
            <p className="kicker">Built on infrastructure you can trust</p>

            <ul className="flex flex-wrap items-center justify-center gap-2.5">
              {STACK.map((s) => (
                <li
                  key={s}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)]/60 px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.12em] text-text-muted"
                >
                  {s}
                </li>
              ))}
            </ul>

            <p className="max-w-xl text-pretty text-sm text-text-muted sm:text-base">
              {count && count > 0
                ? `Join ${count.toLocaleString("en-US")}+ traders already on the early-access list.`
                : "Early access is open — become a founding member before launch."}
            </p>

            <a
              href={TELEGRAM_ALERTS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              See live signals on Telegram
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
