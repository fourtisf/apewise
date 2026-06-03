import { cn } from "@/lib/cn";
import { Reveal } from "./Reveal";

export function SectionHeading({
  kicker,
  title,
  sub,
  center = false,
  className,
}: {
  kicker: string;
  title: string;
  sub?: string;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center", className)}>
      <Reveal>
        <p className="kicker">{kicker}</p>
      </Reveal>
      <Reveal delay={0.05}>
        <h2 className="mt-4 text-balance text-3xl font-semibold text-text sm:text-4xl lg:text-[2.6rem]">
          {title}
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.1}>
          <p className="mt-4 text-pretty text-base text-text-muted sm:text-lg">
            {sub}
          </p>
        </Reveal>
      )}
    </div>
  );
}
