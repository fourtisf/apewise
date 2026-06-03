"use client";

import { Check, Star } from "lucide-react";
import { useStrings } from "@/lib/strings";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export function Pricing() {
  const { strings } = useStrings();
  const p = strings.pricing;

  return (
    <section id="pricing" className="section">
      <div className="container-content">
        <SectionHeading kicker={p.kicker} title={p.title} sub={p.sub} center />
        <div className="mx-auto mt-14 grid max-w-4xl gap-6 sm:grid-cols-2">
          {p.plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.08}>
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-2xl border p-7 sm:p-8",
                  plan.highlighted
                    ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--surface)]/70 shadow-[0_30px_80px_-40px_color-mix(in_srgb,var(--accent)_55%,transparent)]"
                    : "border-[var(--border)] bg-[var(--surface)]/40",
                )}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 start-7">
                    <Badge tone="accent">{p.comingSoon}</Badge>
                  </div>
                )}
                <h3 className="font-display text-xl font-semibold text-text">
                  {plan.name}
                </h3>
                <div className="mt-4 flex items-end gap-1.5">
                  <span className="font-display text-4xl font-semibold text-text">
                    {plan.price}
                  </span>
                  <span className="mb-1.5 text-sm text-text-muted">
                    {plan.period}
                  </span>
                </div>
                <ul className="mt-6 flex flex-1 flex-col gap-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-text-muted"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <Button
                    href="#waitlist"
                    variant={plan.highlighted ? "primary" : "secondary"}
                    className="w-full"
                  >
                    {plan.cta}
                  </Button>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.15}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm text-text-muted">
            <Star className="h-4 w-4 text-amber" aria-hidden />
            <span>{p.stars}</span>
            <span aria-hidden>·</span>
            <span>{p.comingSoon}</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
