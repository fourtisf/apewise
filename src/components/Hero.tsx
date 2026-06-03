"use client";

import { ArrowRight, Check } from "lucide-react";
import { useStrings } from "@/lib/strings";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/ui/Reveal";
import { SmartMoneyFeed } from "./SmartMoneyFeed";
import { StatCounter } from "./StatCounter";

export function Hero() {
  const { strings } = useStrings();
  const h = strings.hero;
  const stats = [h.stats.segments, h.stats.chains, h.stats.languages];

  return (
    <section
      id="top"
      className="relative overflow-hidden pb-16 pt-28 sm:pb-24 sm:pt-32 lg:pt-36"
    >
      {/* central hero glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-6rem] -z-0 h-[40rem] w-[64rem] -translate-x-1/2 rounded-full opacity-50 blur-[100px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%)",
        }}
      />

      <div className="container-content relative">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* Copy */}
          <div>
            <Reveal>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="pulse-dot inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                  </span>
                  {h.badge}
                </Badge>
                <Badge tone="muted">{h.statusBeta}</Badge>
              </div>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="headline-sheen mt-6 text-balance text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">
                {h.h1}
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-6 max-w-xl text-pretty text-base text-text-muted sm:text-lg">
                {h.sub}
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button href="#waitlist" size="lg">
                  {h.ctaPrimary}
                </Button>
                <Button href="/terminal" variant="secondary" size="lg">
                  {h.ctaTerminal}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </Reveal>

            <Reveal delay={0.22}>
              <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
                {h.highlights.map((item) => (
                  <li
                    key={item}
                    className="inline-flex items-center gap-1.5 text-sm text-text-muted"
                  >
                    <Check className="h-4 w-4 text-accent" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.24}>
              <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-[var(--border)] pt-8">
                {stats.map((s) => (
                  <div key={s.label}>
                    <dt className="sr-only">{s.label}</dt>
                    <dd>
                      <StatCounter
                        value={s.value}
                        decimals={s.decimals}
                        suffix={s.suffix}
                        label={s.label}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          {/* Feed */}
          <Reveal delay={0.2}>
            <div className="relative">
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-6 -z-0 rounded-[2rem] opacity-70 blur-3xl"
                style={{
                  background:
                    "radial-gradient(50% 50% at 60% 30%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%), radial-gradient(50% 50% at 30% 80%, color-mix(in srgb, var(--accent-2) 18%, transparent), transparent 70%)",
                }}
              />
              <div className="relative">
                <SmartMoneyFeed />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
