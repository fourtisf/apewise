import { cn } from "@/lib/cn";

/** ApeWise mark — a smart-money uptrend inside a rounded tile. */
export function ApeWiseMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      role="img"
      aria-label="ApeWise"
    >
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
      <path
        d="M7.5 21.5 L13.5 15 L17.5 18.5 L24.5 9.5"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.5" cy="9.5" r="2.6" fill="var(--accent)" />
    </svg>
  );
}

/** Wordmark lockup: mark + "ApeWise" + optional "powered by Fourtis". */
export function BrandLockup({
  poweredBy,
  className,
}: {
  poweredBy?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <ApeWiseMark className="h-8 w-8 shrink-0" />
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
