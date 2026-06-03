"use client";

import {
  Crosshair,
  Layers,
  TrendingUp,
  ShieldCheck,
  Send,
  Languages,
  type LucideIcon,
} from "lucide-react";
import { useStrings } from "@/lib/strings";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { GlassCard } from "@/components/ui/GlassCard";

const ICON_MAP: Record<string, LucideIcon> = {
  Crosshair,
  Layers,
  TrendingUp,
  ShieldCheck,
  Send,
  Languages,
};

export function Features() {
  const { strings } = useStrings();
  const f = strings.features;

  return (
    <section id="features" className="section">
      <div className="container-content">
        <SectionHeading kicker={f.kicker} title={f.title} sub={f.sub} />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {f.items.map((item, i) => {
            const Icon = ICON_MAP[item.icon] ?? Crosshair;
            return (
              <Reveal key={item.title} delay={(i % 3) * 0.07}>
                <GlassCard interactive className="group h-full">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-accent transition-colors group-hover:border-[var(--border-strong)]">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-text">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-muted">
                    {item.body}
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
