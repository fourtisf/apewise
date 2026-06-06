import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Adds lift + border highlight on hover. */
  interactive?: boolean;
  className?: string;
}

export function GlassCard({
  children,
  interactive = false,
  className,
  ...rest
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "glass p-6 sm:p-7",
        interactive &&
          "transition-all duration-300 hover:-translate-y-1 hover:border-[color:color-mix(in_srgb,var(--accent)_40%,var(--border-strong))] hover:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8),0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent),0_22px_70px_-30px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
