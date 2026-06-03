import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "default" | "accent" | "violet" | "muted";

const tones: Record<Tone, string> = {
  default:
    "border-[var(--border)] bg-[var(--surface)]/70 text-text-muted",
  accent:
    "border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent",
  violet:
    "border-[color:color-mix(in_srgb,var(--accent-2)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-2)_14%,transparent)] text-[color:color-mix(in_srgb,var(--accent-2)_70%,white)]",
  muted: "border-transparent bg-[var(--surface-2)] text-text-muted",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
