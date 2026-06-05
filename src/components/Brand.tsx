import Image from "next/image";
import { cn } from "@/lib/cn";

/** ApeWise mark — the King Kong gorilla logo. */
export function ApeWiseMark({ className }: { className?: string }) {
  return (
    <Image
      src="/apewise-logo.png"
      alt="ApeWise"
      width={64}
      height={64}
      priority
      className={cn("rounded-lg object-cover", className)}
    />
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
