import { cn } from "@/lib/cn";

/**
 * ApeWise monogram — an "AW" ligature drawn as a rising smart-money chart:
 * the **A** (peak + crossbar) flows straight into a **W** zig-zag and resolves
 * on the signal dot. Premium emerald (a `--brand-hi → --brand-lo` gradient, lit
 * from the top) on the dark brand tile. Tokens keep it themeable; the gradient
 * is defined in the mark's own 0–32 space so every instance renders correctly.
 */
export function ApeWiseMonogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      role="img"
      aria-label="ApeWise"
    >
      <defs>
        <linearGradient
          id="apewise-brand"
          x1="0"
          y1="7"
          x2="0"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--brand-hi)" />
          <stop offset="1" stopColor="var(--brand-lo)" />
        </linearGradient>
      </defs>
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="9"
        fill="#14161B"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      {/* A → W rising ligature */}
      <path
        d="M6 23.4 L11 9.2 L15 16.8 L19 11.4 L22.2 15.4 L26 8"
        stroke="url(#apewise-brand)"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* crossbar of the A */}
      <path
        d="M9.4 13.8 L13.4 13.8"
        stroke="url(#apewise-brand)"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      {/* smart-money signal dot */}
      <circle cx="26" cy="8" r="2.5" fill="url(#apewise-brand)" />
    </svg>
  );
}

/**
 * @deprecated Use {@link ApeWiseMonogram}. Kept as a stable alias so existing
 * imports keep resolving to the canonical mark.
 */
export const ApeWiseMark = ApeWiseMonogram;

/** Wordmark lockup: monogram + "ApeWise" + optional "powered by Fourtis". */
export function BrandLockup({
  poweredBy,
  className,
}: {
  poweredBy?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <ApeWiseMonogram className="h-8 w-8 shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-semibold tracking-tight text-text">
          ApeWise
        </span>
        {poweredBy && (
          <span className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-muted">
            {poweredBy}
          </span>
        )}
      </span>
    </span>
  );
}
