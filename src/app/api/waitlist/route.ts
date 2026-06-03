import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// fs access requires the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Durable, zero-config sink: every signup is appended as one JSON line to a local
// file that survives restarts AND `git reset --hard` deploys (it's gitignored, and
// reset never removes untracked files). Point WAITLIST_FILE elsewhere, or set
// WAITLIST_WEBHOOK_URL, to forward into a real DB / CRM / ESP later.
const WAITLIST_FILE =
  process.env.WAITLIST_FILE ||
  path.join(process.cwd(), "data", "waitlist.jsonl");

interface Signup {
  email: string;
  ts: string;
  source: string;
  locale?: string;
  ref?: string;
  ip?: string;
  userAgent?: string;
}

async function alreadySignedUp(email: string): Promise<boolean> {
  try {
    const contents = await fs.readFile(WAITLIST_FILE, "utf8");
    return contents.includes(`"email":${JSON.stringify(email)}`);
  } catch {
    return false; // file doesn't exist yet
  }
}

async function persist(signup: Signup): Promise<void> {
  await fs.mkdir(path.dirname(WAITLIST_FILE), { recursive: true });
  await fs.appendFile(WAITLIST_FILE, JSON.stringify(signup) + "\n", "utf8");
}

export async function POST(request: Request) {
  let email = "";
  let locale: string | undefined;
  let ref: string | undefined;
  try {
    const body = (await request.json()) as {
      email?: unknown;
      locale?: unknown;
      ref?: unknown;
    };
    email = typeof body.email === "string" ? body.email.trim() : "";
    locale = typeof body.locale === "string" ? body.locale : undefined;
    ref = typeof body.ref === "string" ? body.ref : undefined;
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

  const signup: Signup = {
    email: email.toLowerCase(),
    ts: new Date().toISOString(),
    source: "apewise-landing",
    locale,
    ref,
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  };

  try {
    if (await alreadySignedUp(signup.email)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    await persist(signup);
  } catch (err) {
    console.error("[waitlist] failed to persist signup:", err);
    // Only hard-fail if there's no webhook fallback to catch the lead.
    if (!process.env.WAITLIST_WEBHOOK_URL) {
      return NextResponse.json(
        { ok: false, error: "Could not save your signup. Please try again." },
        { status: 500 },
      );
    }
  }

  const webhook = process.env.WAITLIST_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup),
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
