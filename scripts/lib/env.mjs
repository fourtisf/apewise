/**
 * Load .env.local then .env into process.env (existing vars win). Plain Node
 * workers don't read dotenv files — only Next does — so a secret set in
 * .env.local (e.g. INGEST_SECRET) was invisible to the PM2 workers: they'd
 * call the dispatch endpoints WITHOUT the secret, get 401 forever, and the
 * channels would look dead with nothing in the logs. Every worker loads this
 * first so app and workers always agree on the same config.
 */
import { readFile } from "node:fs/promises";

async function loadFile(file) {
  let txt = "";
  try {
    txt = await readFile(file, "utf8");
  } catch {
    return;
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

/** Load .env.local, then .env, relative to the current working directory. */
export async function loadEnv() {
  await loadFile(".env.local");
  await loadFile(".env");
}
