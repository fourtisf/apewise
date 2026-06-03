"use client";

import { AlertTriangle, Clock, ShieldAlert, type LucideIcon } from "lucide-react";
import { useStrings } from "@/lib/strings";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { GlassCard } from "@/components/ui/GlassCard";

const ICONS: LucideIcon[] = [AlertTriangle, Clock, ShieldAlert];

export function Problem() {
  const { strings } = useStrings();
  const p = strings.problem;

  return (
    <section className="section">
      <div className="container-content">
        <SectionHeading kicker={p.kicker} title={p.title} />
        <Reveal delay={0.05}>
          <p className="mt-6 max-w-3xl text-pretty text-base text-text-muted sm:text-lg">
            {p.body}
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {p.points.map((point, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <Reveal key={point.title} delay={i * 0.08}>
                <GlassCard className="h-full">
                  <Icon className="h-6 w-6 text-amber" />
                  <h3 className="mt-4 text-lg font-semibold text-text">
                    {point.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-muted">
                    {point.body}
                  </p>
                </GlassCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
