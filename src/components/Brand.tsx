import { cn } from "@/lib/cn";

/**
 * ApeWise mark — a diving whale tail (fluke) in premium emerald
 * (`--brand-hi → --brand-lo`, lit from the top) on a pure-black, borderless tile
 * with a soft emerald glow. Iconic for a whale-money tracker and legible down to
 * favicon sizes; themeable via brand tokens. Path is baked into 0–32 space.
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
        <linearGradient id="apewise-brand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand-hi)" />
          <stop offset="1" stopColor="var(--brand-lo)" />
        </linearGradient>
        <filter
          id="apewise-glow"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.85" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* pure-black, borderless tile */}
      <rect x="0" y="0" width="32" height="32" rx="9" fill="#000000" />
      <g filter="url(#apewise-glow)">
        {/* whale-tail (fluke) mark */}
        <path
          d="M16,13.4 C14.2,11.6 11.4,9 5.6,7.2 C9,10.6 12.4,13.8 14.8,17.6 C15.3,20.2 15.7,22.6 16,24.8 C16.3,22.6 16.7,20.2 17.2,17.6 C19.6,13.8 23,10.6 26.4,7.2 C20.6,9 17.8,11.6 16,13.4 Z"
          fill="url(#apewise-brand)"
        />
      </g>
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
