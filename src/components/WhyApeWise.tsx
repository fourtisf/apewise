"use client";

import { Check, Minus } from "lucide-react";
import { useStrings } from "@/lib/strings";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";

function Cell({
  value,
  positive = false,
}: {
  value: boolean | string;
  positive?: boolean;
}) {
  if (typeof value === "string") {
    return (
      <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
        {value}
      </span>
    );
  }
  if (value) {
    return (
      <Check
        className={cn("mx-auto h-5 w-5", positive ? "text-accent" : "text-text-muted")}
        aria-label="Yes"
      />
    );
  }
  return (
    <Minus className="mx-auto h-5 w-5 text-text-muted opacity-40" aria-label="No" />
  );
}

export function WhyApeWise() {
  const { strings } = useStrings();
  const w = strings.why;

  return (
    <section className="section">
      <div className="container-content">
        <SectionHeading kicker={w.kicker} title={w.title} sub={w.sub} />
        <Reveal delay={0.1}>
          <div className="mt-12 overflow-x-auto rounded-2xl border border-[var(--border)]">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="bg-[var(--surface)]">
                  <th className="px-5 py-4 text-sm font-medium text-text-muted sm:px-6">
                    {w.columns.feature}
                  </th>
                  <th className="px-4 py-4 text-center text-sm font-semibold text-accent sm:px-6">
                    {w.columns.apewise}
                  </th>
                  <th className="px-4 py-4 text-center text-sm font-medium text-text-muted sm:px-6">
                    {w.columns.generic}
                  </th>
                </tr>
              </thead>
              <tbody>
                {w.rows.map((row, i) => (
                  <tr
                    key={row.label}
                    className={cn(
                      "border-t border-[var(--border)]",
                      i % 2 ? "bg-[var(--surface)]/30" : "bg-transparent",
                    )}
                  >
                    <td className="px-5 py-4 text-sm text-text sm:px-6">
                      {row.label}
                    </td>
                    <td className="px-4 py-4 text-center sm:px-6">
                      <Cell value={row.apewise} positive />
                    </td>
                    <td className="px-4 py-4 text-center sm:px-6">
                      <Cell value={row.generic} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
