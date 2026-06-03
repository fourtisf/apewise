"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useStrings } from "@/lib/strings";
import { Button } from "@/components/ui/Button";
import { BrandLockup } from "@/components/Brand";
import { cn } from "@/lib/cn";
import { TELEGRAM_ALERTS_URL } from "@/lib/site";

export function Nav() {
  const { strings } = useStrings();
  const n = strings.nav;
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const links: { href: string; label: string; external?: boolean }[] = [
    { href: "#features", label: n.links.features },
    { href: "#how", label: n.links.how },
    { href: "/terminal", label: n.links.terminal },
    { href: "#pricing", label: n.links.pricing },
    { href: TELEGRAM_ALERTS_URL, label: n.links.alerts, external: true },
  ];

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled || open
          ? "border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--bg)_72%,transparent)] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <nav
        className={cn(
          "container-content flex items-center justify-between transition-[height] duration-300",
          scrolled ? "h-14 sm:h-16" : "h-16 sm:h-20",
        )}
        aria-label="Primary"
      >
        <a href="#top" className="-m-1 rounded-lg p-1" aria-label={n.brand}>
          <BrandLockup poweredBy={n.poweredBy} />
        </a>

        <div className="hidden items-center gap-8 lg:flex">
          <ul className="flex items-center gap-7 text-sm text-text-muted">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  {...(l.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className="transition-colors hover:text-text"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <Button href="#waitlist" size="sm">
            {n.cta}
          </Button>
        </div>

        <button
          type="button"
          className="-m-2 inline-flex items-center justify-center rounded-lg p-2 text-text lg:hidden"
          aria-label={open ? n.closeMenu : n.openMenu}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        id="mobile-menu"
        className={cn(
          "overflow-hidden border-t border-[var(--border)] bg-[color:color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur-xl transition-[max-height,opacity] duration-300 lg:hidden",
          open ? "max-h-96 opacity-100" : "pointer-events-none max-h-0 opacity-0",
        )}
      >
        <ul className="container-content flex flex-col gap-1 py-4">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                onClick={() => setOpen(false)}
                {...(l.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="block rounded-xl px-3 py-3 text-base text-text-muted transition-colors hover:bg-[var(--surface)] hover:text-text"
              >
                {l.label}
              </a>
            </li>
          ))}
          <li className="px-1 pt-2">
            <Button
              href="#waitlist"
              className="w-full"
              onClick={() => setOpen(false)}
            >
              {n.cta}
            </Button>
          </li>
        </ul>
      </div>
    </header>
  );
}
