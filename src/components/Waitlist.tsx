"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useStrings } from "@/lib/strings";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Button } from "@/components/ui/Button";
import { TELEGRAM_ALERTS_URL } from "@/lib/site";
import { track } from "@/lib/analytics";

type Status = "idle" | "loading" | "success" | "error";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Waitlist() {
  const { strings, locale } = useStrings();
  const w = strings.waitlist;
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) {
      setStatus("error");
      setMessage(w.errorInvalid);
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("success");
      setMessage(w.success);
      setEmail("");
      track("Waitlist Signup", { locale });
    } catch {
      setStatus("error");
      setMessage(w.errorGeneric);
    }
  }

  const busy = status === "loading" || status === "success";

  return (
    <section id="waitlist" className="section">
      <div className="container-content">
        <Reveal>
          <div className="glass relative overflow-hidden px-6 py-12 sm:px-12 sm:py-16">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full opacity-50 blur-3xl"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent), transparent 65%)",
              }}
            />
            <div className="relative mx-auto max-w-2xl text-center">
              <SectionHeading
                kicker={w.kicker}
                title={w.title}
                sub={w.sub}
                center
                className="max-w-2xl"
              />

              <form
                onSubmit={onSubmit}
                noValidate
                className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
              >
                <label htmlFor="waitlist-email" className="sr-only">
                  {w.placeholder}
                </label>
                <input
                  id="waitlist-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (status === "error") setStatus("idle");
                  }}
                  placeholder={w.placeholder}
                  aria-invalid={status === "error"}
                  disabled={busy}
                  className="h-12 flex-1 rounded-full border border-[var(--border)] bg-[var(--bg)]/70 px-5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent disabled:opacity-60"
                />
                <Button type="submit" size="lg" disabled={busy}>
                  {status === "success" ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : status === "loading" ? (
                    w.sending
                  ) : (
                    <>
                      {w.cta}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </Button>
              </form>

              <div
                className="mt-3 min-h-[1.25rem] text-sm"
                role="status"
                aria-live="polite"
              >
                {status === "success" && (
                  <span className="text-accent">{message}</span>
                )}
                {status === "error" && <span className="text-red">{message}</span>}
                {(status === "idle" || status === "loading") && (
                  <span className="text-text-muted">{w.disclaimer}</span>
                )}
              </div>

              <p className="mt-6 text-sm text-text-muted">
                {w.telegramPrompt}{" "}
                <a
                  href={TELEGRAM_ALERTS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline-offset-4 hover:underline"
                >
                  {w.telegramCta}
                </a>
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
