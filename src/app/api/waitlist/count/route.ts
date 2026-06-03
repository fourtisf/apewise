import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE =
  process.env.WAITLIST_FILE ||
  path.join(process.cwd(), "data", "waitlist.jsonl");

/** Public count of waitlist signups (for social proof). Returns 0 if none yet. */
export async function GET() {
  try {
    const txt = await fs.readFile(FILE, "utf8");
    const count = txt.trim().split("\n").filter(Boolean).length;
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
