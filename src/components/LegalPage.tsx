import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { type ReactNode } from "react";
import { BrandLockup } from "@/components/Brand";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="container-content py-16 sm:py-24">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to home
      </Link>

      <div className="mt-10">
        <BrandLockup poweredBy="powered by Fourtis" />
      </div>

      <h1 className="mt-8 text-3xl font-semibold text-text sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-text-muted">Last updated {updated}</p>

      <div className="mt-8 max-w-2xl space-y-4 text-sm leading-relaxed text-text-muted [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text [&_a]:text-accent">
        {children}
      </div>
    </main>
  );
}
