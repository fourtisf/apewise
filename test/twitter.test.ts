import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  pctEncode,
  oauth1Header,
  classifyTweetFailure,
} from "../src/lib/server/twitter.ts";

test("pctEncode: RFC 3986 (encodeURIComponent + !*'())", () => {
  assert.equal(pctEncode("a b"), "a%20b");
  assert.equal(pctEncode("!*'()"), "%21%2A%27%28%29");
  assert.equal(pctEncode("~-._"), "~-._"); // unreserved, untouched
  assert.equal(pctEncode("=&"), "%3D%26");
  assert.equal(pctEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
});

test("oauth1Header: known base string + valid HMAC-SHA1 signature", () => {
  const creds = {
    consumerKey: "ck",
    consumerSecret: "cs",
    token: "tok",
    tokenSecret: "ts",
  };
  const header = oauth1Header({
    method: "POST",
    url: "https://api.twitter.com/2/tweets",
    creds,
    nonce: "abc",
    timestamp: 1000000000,
  });

  // Base string is fully determined by the fixed inputs — hand-written here so
  // the test fails loudly on any param-ordering or percent-encoding regression.
  const baseString =
    "POST&https%3A%2F%2Fapi.twitter.com%2F2%2Ftweets&" +
    "oauth_consumer_key%3Dck%26oauth_nonce%3Dabc%26" +
    "oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1000000000%26" +
    "oauth_token%3Dtok%26oauth_version%3D1.0";
  const expectedSig = crypto
    .createHmac("sha1", "cs&ts")
    .update(baseString)
    .digest("base64");

  assert.ok(header.startsWith("OAuth "));
  assert.match(header, /oauth_signature_method="HMAC-SHA1"/);
  assert.match(header, /oauth_consumer_key="ck"/);
  assert.match(header, /oauth_token="tok"/);
  assert.match(header, /oauth_version="1.0"/);
  // The signature must match the independently-computed HMAC of the base string.
  assert.ok(
    header.includes(`oauth_signature="${pctEncode(expectedSig)}"`),
    `signature mismatch; header=${header}`,
  );
});

test("oauth1Header: secrets with reserved chars are percent-encoded in the signing key", () => {
  // A tokenSecret containing '&' must not corrupt the signing key; just assert
  // the call produces a well-formed header (no throw, has a signature).
  const header = oauth1Header({
    method: "POST",
    url: "https://api.twitter.com/2/tweets",
    creds: { consumerKey: "c k", consumerSecret: "c&s", token: "t k", tokenSecret: "t&s" },
    nonce: "n1",
    timestamp: 1234567890,
  });
  assert.match(header, /oauth_signature="[^"]+"/);
  assert.match(header, /oauth_consumer_key="c%20k"/);
});

test("classifyTweetFailure: duplicate beats status code", () => {
  // X reports duplicate content as 403 — must NOT be mistaken for dead keys.
  const r = classifyTweetFailure(403, '{"detail":"You are not allowed to create a Tweet with duplicate content."}');
  assert.equal(r.duplicate, true);
  assert.equal(r.authFailed, undefined);
  assert.equal(r.error, "duplicate");
});

test("classifyTweetFailure: plain 429 is transient rate-limit", () => {
  const r = classifyTweetFailure(429, '{"title":"Too Many Requests"}');
  assert.equal(r.rateLimited, true);
  assert.equal(r.capped, undefined);
  assert.equal(r.error, "rate-limited");
});

test("classifyTweetFailure: monthly usage cap is flagged as capped", () => {
  const r = classifyTweetFailure(
    429,
    '{"title":"UsageCapExceeded","period":"Monthly","scope":"Product"}',
  );
  assert.equal(r.capped, true);
  assert.equal(r.rateLimited, true);
  assert.equal(r.error, "usage-capped");
});

test("classifyTweetFailure: 401/403 without duplicate detail = dead credentials", () => {
  assert.equal(classifyTweetFailure(401, "Unauthorized").authFailed, true);
  assert.equal(classifyTweetFailure(401, "Unauthorized").error, "auth-401");
  const forbidden = classifyTweetFailure(403, '{"detail":"Forbidden"}');
  assert.equal(forbidden.authFailed, true);
  assert.equal(forbidden.error, "auth-403");
});

test("classifyTweetFailure: other statuses pass through", () => {
  const r = classifyTweetFailure(500, "oops");
  assert.equal(r.error, "http-500");
  assert.equal(r.authFailed, undefined);
  assert.equal(r.rateLimited, undefined);
});
