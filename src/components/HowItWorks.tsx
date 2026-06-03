"use client";

import { useStrings } from "@/lib/strings";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";

export function HowItWorks() {
  const { strings } = useStrings();
  const h = strings.how;

  return (
    <section id="how" className="section">
      <div className="container-content">
        <SectionHeading kicker={h.kicker} title={h.title} center />
        <ol className="relative mt-16 grid gap-10 sm:grid-cols-3 sm:gap-6">
          {/* connecting line on desktop */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent sm:block"
          />
          {h.steps.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.1}>
              <li className="relative flex flex-col items-center text-center sm:items-start sm:text-start">
                <span className="relative z-10 grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] font-display text-xl font-semibold text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-text">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-text-muted">
                  {step.body}
                </p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
