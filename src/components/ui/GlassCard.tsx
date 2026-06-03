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
          "transition-all duration-300 hover:-translate-y-1 hover:border-[var(--border-strong)] hover:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
