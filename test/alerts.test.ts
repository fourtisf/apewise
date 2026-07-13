import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, socialLinks, fmtUsd } from "../src/lib/server/alerts.ts";

// Telegram messages are sent with parse_mode: "HTML" — any unescaped &, <, >
// in a token symbol/label makes sendMessage fail with 400 "can't parse
// entities" and the alert is silently lost. These lock the escaping in.

test("escapeHtml: neutralizes HTML-special characters", () => {
  assert.equal(escapeHtml("M&M"), "M&amp;M");
  assert.equal(escapeHtml("<3"), "&lt;3");
  assert.equal(escapeHtml("a>b"), "a&gt;b");
  assert.equal(escapeHtml('say "gm"'), "say &quot;gm&quot;");
  assert.equal(escapeHtml("PEPE"), "PEPE"); // clean symbols untouched
});

test("socialLinks: URLs are attribute-safe", () => {
  const out = socialLinks("MINT123", {
    website: 'https://evil.example/"><script>x</script>',
    twitter: "https://x.com/token",
  });
  assert.ok(out);
  assert.doesNotMatch(out as string, /"><script>/);
  assert.match(out as string, /dexscreener\.com\/solana\/MINT123/);
  assert.match(out as string, /https:\/\/x\.com\/token/);
});

test("socialLinks: null when nothing to link", () => {
  assert.equal(socialLinks(undefined, undefined), null);
});

test("fmtUsd: compact units", () => {
  assert.equal(fmtUsd(1_200_000), "$1.2M");
  assert.equal(fmtUsd(25_000), "$25k");
  assert.equal(fmtUsd(undefined), null);
});
