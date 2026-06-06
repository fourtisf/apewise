import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

interface OwnProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  href?: string;
  children: ReactNode;
}

type Props = OwnProps &
  Omit<
    ButtonHTMLAttributes<HTMLButtonElement> &
      AnchorHTMLAttributes<HTMLAnchorElement>,
    keyof OwnProps
  >;

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium leading-none transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(180deg,var(--brand-hi),var(--brand-lo))] text-[#04140e] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_30px_-10px_color-mix(in_srgb,var(--accent)_70%,transparent)] hover:brightness-[1.06] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_16px_46px_-12px_color-mix(in_srgb,var(--accent)_88%,transparent)] active:scale-[0.98]",
  secondary:
    "border border-[var(--border)] bg-[var(--surface)]/60 text-text backdrop-blur-md hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] active:scale-[0.98]",
  ghost: "text-text-muted hover:text-text",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[0.95rem]",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  href,
  children,
  ...rest
}: Props) {
  const classes = cn(base, variants[variant], sizes[size], className);

  if (href !== undefined) {
    const external = /^https?:/.test(href);
    return (
      <a
        href={href}
        className={classes}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
        {external && <ArrowUpRight className="h-4 w-4" aria-hidden />}
      </a>
    );
  }

  return (
    <button
      className={classes}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}
