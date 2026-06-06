"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

interface StatCounterProps {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  label: string;
  durationMs?: number;
}

/** Count-up on first view with easeOut; jumps straight to final under reduced motion. */
export function StatCounter({
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  label,
  durationMs = 1500,
}: StatCounterProps) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / durationMs);
              const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
              setDisplay(value * eased);
              if (t < 1) requestAnimationFrame(tick);
              else setDisplay(value);
            };
            requestAnimationFrame(tick);
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, durationMs, reduce]);

  const formatted = `${prefix}${display.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;

  return (
    <div ref={ref}>
      <div className="stat-value font-display text-3xl font-semibold tabular-nums sm:text-4xl">
        {formatted}
      </div>
      <div className="mt-1 text-sm text-text-muted">{label}</div>
    </div>
  );
}
