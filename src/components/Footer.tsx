"use client";

import Link from "next/link";
import { useStrings } from "@/lib/strings";
import { BrandLockup } from "@/components/Brand";
import {
  X_URL,
  TELEGRAM_MAIN,
  TELEGRAM_ALERTS_URL,
  SITE_NAME,
  FOURTIS_URL,
} from "@/lib/site";

export function Footer() {
  const { strings } = useStrings();
  const f = strings.footer;
  const year = new Date().getFullYear();

  const product: { href: string; label: string }[] = [
    { href: "#features", label: f.columns.product.links.features },
    { href: "#how", label: f.columns.product.links.how },
    { href: "#pricing", label: f.columns.product.links.pricing },
    { href: "#waitlist", label: f.columns.product.links.waitlist },
  ];
  const community: { href: string; label: string }[] = [
    { href: X_URL, label: f.columns.community.links.x },
    { href: TELEGRAM_MAIN, label: f.columns.community.links.telegram },
    { href: TELEGRAM_ALERTS_URL, label: f.columns.community.links.alerts },
  ];
  const legal: { href: string; label: string }[] = [
    { href: "/privacy", label: f.columns.legal.links.privacy },
    { href: "/terms", label: f.columns.legal.links.terms },
  ];

  return (
    <footer className="border-t border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_35%,transparent)]">
      <div className="container-content py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <BrandLockup poweredBy={f.poweredBy} />
            <p className="mt-5 text-sm leading-relaxed text-text-muted">
              {f.tagline}
            </p>
          </div>

          <FooterColumn title={f.columns.product.title} links={product} />
          <FooterColumn
            title={f.columns.community.title}
            links={community}
            external
          />
          <FooterColumn title={f.columns.legal.title} links={legal} />
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[var(--border)] pt-6 text-sm text-text-muted sm:flex-row">
          <p>
            © {year} {SITE_NAME}. {f.rights}
          </p>
          <p>
            <a
              href={FOURTIS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-text"
            >
              {f.poweredBy}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
  external = false,
}: {
  title: string;
  links: { href: string; label: string }[];
  external?: boolean;
}) {
  return (
    <div>
      <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-text-muted">
        {title}
      </h3>
      <ul className="mt-4 flex flex-col gap-3 text-sm">
        {links.map((l) => {
          // Internal route → next/link; hash/external → plain anchor.
          const isInternalRoute = l.href.startsWith("/");
          return (
            <li key={l.href}>
              {isInternalRoute ? (
                <Link
                  href={l.href}
                  className="text-text-muted transition-colors hover:text-text"
                >
                  {l.label}
                </Link>
              ) : (
                <a
                  href={l.href}
                  {...(external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className="text-text-muted transition-colors hover:text-text"
                >
                  {l.label}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
