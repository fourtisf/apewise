#!/usr/bin/env node
/**
 * Credential check for the X / Twitter auto-tweet channel. Pure JS — runs on any
 * Node 18+ (no --experimental-strip-types, no --env-file): it loads .env.local
 * from the current directory itself and signs with OAuth 1.0a via node:crypto.
 * Mirrors the signing in src/lib/server/twitter.ts.
 *
 *   cd /var/www/apewise    # dir that has .env.local
 *   node scripts/tweet-test.mjs "hello from the apewise bot"
 *
 * Exits 0 on a posted tweet, 1 on any failure (missing keys, 401/403, etc.).
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  let txt = "";
  try {
    txt = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
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
    )
      val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvLocal();

const creds = {
  consumerKey: process.env.TWITTER_API_KEY,
  consumerSecret: process.env.TWITTER_API_SECRET,
  token: process.env.TWITTER_ACCESS_TOKEN,
  tokenSecret: process.env.TWITTER_ACCESS_SECRET,
};

const missing = Object.entries({
  TWITTER_API_KEY: creds.consumerKey,
  TWITTER_API_SECRET: creds.consumerSecret,
  TWITTER_ACCESS_TOKEN: creds.token,
  TWITTER_ACCESS_SECRET: creds.tokenSecret,
})
  .filter(([, v]) => !v || String(v).startsWith("__"))
  .map(([k]) => k);

if (missing.length) {
  console.error("✗ Belum keisi di .env.local: " + missing.join(", "));
  console.error(
    "  (Bearer Token TIDAK bisa buat posting — butuh Access Token + Secret\n" +
      "   yang di-generate saat app permission = Read and Write.)",
  );
  process.exit(1);
}

const pct = (s) =>
  encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

function authHeader(method, url) {
  const p = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(p)
    .map((k) => [pct(k), pct(p[k])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramStr)].join("&");
  const signingKey = `${pct(creds.consumerSecret)}&${pct(creds.tokenSecret)}`;
  p.oauth_signature = crypto
    .createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");
  return (
    "OAuth " +
    Object.keys(p)
      .sort()
      .map((k) => `${pct(k)}="${pct(p[k])}"`)
      .join(", ")
  );
}

const text =
  process.argv.slice(2).join(" ") ||
  `apewise auto-tweet test ✅ ${new Date().toISOString()}`;
const url = "https://api.twitter.com/2/tweets";

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: authHeader("POST", url),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ text }),
});
const body = await res.text();

if (res.ok) {
  let id;
  try {
    id = JSON.parse(body).data?.id;
  } catch {
    /* ignore */
  }
  console.log(`✓ Berhasil posting. Tweet id: ${id ?? "(?)"}`);
  console.log(`  teks: ${text}`);
  process.exit(0);
}

console.error(`✗ Gagal (HTTP ${res.status}): ${body.slice(0, 400)}`);
if (res.status === 403)
  console.error(
    "  403 → app harus Read+Write DAN Access Token di-regenerate setelah Write aktif,\n" +
      "        atau plan/credit-mu belum mengizinkan POST.",
  );
if (res.status === 401)
  console.error(
    "  401 → tanda tangan/keys salah. Cek lagi 4 nilai (jangan ada spasi/kutip nyasar).",
  );
process.exit(1);
