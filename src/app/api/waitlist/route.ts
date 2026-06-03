import { NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Waitlist capture — STUB.
 * Validates the email, logs it, and (optionally) forwards to WAITLIST_WEBHOOK_URL.
 * TODO: replace with real capture (DB / CRM / ESP) before public launch.
 */
export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Please provide a valid email address." },
      { status: 422 },
    );
  }

  // TODO: persist this somewhere durable.
  console.log(`[waitlist] signup: ${email} @ ${new Date().toISOString()}`);

  const webhook = process.env.WAITLIST_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "apewise-landing", ts: Date.now() }),
      });
    } catch (err) {
      // Never fail the user's request because a downstream webhook hiccuped.
      console.error("[waitlist] webhook forward failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

export function GET() {
  return NextResponse.json({
    ok: true,
    message: "POST an { email } to join the ApeWise waitlist.",
  });
}
