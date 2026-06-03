"use client";

import { useStrings } from "@/lib/strings";
import { Reveal } from "@/components/ui/Reveal";

export function TrustStrip() {
  const { strings } = useStrings();
  const t = strings.trust;

  return (
    <section className="border-y border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_40%,transparent)]">
      <Reveal>
        <div className="container-content flex flex-col items-center gap-6 py-8 sm:flex-row sm:justify-between">
          <p className="kicker text-center sm:text-start">{t.label}</p>
          <ul className="flex flex-wrap items-center justify-center gap-2.5">
            {t.chains.map((chain) => (
              <li
                key={chain}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)]/60 px-3.5 py-1.5 text-sm text-text-muted"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--accent-2)" }}
                />
                {chain}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}
