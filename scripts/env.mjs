/**
 * Load .env.local into process.env for plain-`node` scripts (only Next reads
 * the file by itself). Without this, PM2-run workers can't see INGEST_SECRET /
 * PORT / the tuning vars that live in .env.local — the dispatch endpoints then
 * answer 401 on every tick and the channels go silent with no log evidence.
 * Existing env vars win, so an inline override still takes effect.
 *
 * Usage (top of any scripts/*.mjs):
 *   import { loadDotEnvLocal } from "./env.mjs";
 *   await loadDotEnvLocal();
 */
import { readFile } from "node:fs/promises";

export async function loadDotEnvLocal() {
  let txt = "";
  try {
    txt = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    try {
      txt = await readFile(".env.local", "utf8"); // fallback: cwd
    } catch {
      return;
    }
  }
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(" #"); // strip an unquoted inline comment
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
