#!/usr/bin/env node
/**
 * One-shot credential check for the X / Twitter auto-tweet channel. Posts a
 * single test tweet using the SAME OAuth 1.0a client the app uses, so a success
 * here proves the four TWITTER_* keys are valid AND have write permission.
 *
 * Reuses src/lib/server/twitter.ts (no logic duplicated → no drift). Plain Node
 * doesn't read .env.local, so pass it explicitly with --env-file:
 *
 *   node --experimental-strip-types --env-file=.env.local \
 *        scripts/tweet-test.mjs "hello from the apewise bot"
 *
 * Exits 0 on a posted tweet, 1 on any failure (missing keys, 401/403, etc.).
 */
import { postTweet, twitterConfigured } from "../src/lib/server/twitter.ts";

if (!twitterConfigured()) {
  console.error(
    "✗ Missing X keys. All FOUR are required:\n" +
      "  TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET\n" +
      "A Bearer Token is NOT enough — posting needs the Access Token + Secret\n" +
      "(generated while the app has Read and Write permission).",
  );
  process.exit(1);
}

// Vary the text each run so X never rejects it as a duplicate.
const text =
  process.argv.slice(2).join(" ") ||
  `apewise auto-tweet test ✅ ${new Date().toISOString()}`;

const res = await postTweet(text);

if (res.ok) {
  console.log(`✓ Posted. Tweet id: ${res.id ?? "(unknown)"}`);
  console.log(`  text: ${text}`);
  process.exit(0);
}

console.error("✗ Post failed:", res);
if (res.error === "http-403") {
  console.error(
    "  403 usually means the Access Token lacks write permission — set the app\n" +
      "  to Read and Write, then REGENERATE the Access Token & Secret.",
  );
}
process.exit(1);
