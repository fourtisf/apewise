import crypto from "crypto";

/**
 * Minimal X (Twitter) API v2 client — posts to `POST /2/tweets` with an
 * OAuth 1.0a user-context signature. Zero external deps (Node `crypto`), matching
 * the rest of the codebase.
 *
 * Why OAuth 1.0a: for a single app-owned bot account it uses four static keys
 * (API key/secret + the account's access token/secret) and needs no refresh
 * flow, so it survives restarts with no state. Create them at
 * developer.x.com → your app → "Keys and tokens" (give the app **Read and
 * Write** permission, then regenerate the access token so it inherits write).
 *
 * Fail-soft: with keys missing it logs the composed tweet and reports
 * `{ ok:false, dryRun:true }` so nothing else in the pipeline breaks and the
 * caller can leave rate-limit state untouched until keys are configured.
 */

export interface TweetResult {
  ok: boolean;
  id?: string;
  /** True when no keys are configured — the tweet was previewed, not sent. */
  dryRun?: boolean;
  /** True when X rejected the text as a recent duplicate (safe to skip). */
  duplicate?: boolean;
  /** True when X rate-limited us (HTTP 429) — back off. */
  rateLimited?: boolean;
  error?: string;
}

interface OAuthCreds {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

function readCreds(): OAuthCreds | null {
  const consumerKey = process.env.TWITTER_API_KEY;
  const consumerSecret = process.env.TWITTER_API_SECRET;
  const token = process.env.TWITTER_ACCESS_TOKEN;
  const tokenSecret = process.env.TWITTER_ACCESS_SECRET;
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) return null;
  return { consumerKey, consumerSecret, token, tokenSecret };
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
export function pctEncode(v: string): string {
  return encodeURIComponent(v).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Build the OAuth 1.0a `Authorization` header for a request. Deterministic given
 * `nonce`/`timestamp` (injected in tests). For X v2 endpoints the JSON body is
 * NOT part of the signature base string — only the OAuth params (and any query
 * params) are signed — so we never hash the body here.
 */
export function oauth1Header(args: {
  method: string;
  url: string;
  creds: OAuthCreds;
  nonce: string;
  timestamp: number;
  /** Extra params to sign (e.g. URL query params). None for POST /2/tweets. */
  extraParams?: Record<string, string>;
}): string {
  const { method, url, creds, nonce, timestamp, extraParams = {} } = args;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };

  // Signature base string: percent-encode every key+value, sort by encoded key
  // (then value), join as k=v&k=v.
  const allParams = { ...oauthParams, ...extraParams };
  const paramString = Object.keys(allParams)
    .map((k) => [pctEncode(k), pctEncode(allParams[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    pctEncode(url),
    pctEncode(paramString),
  ].join("&");

  const signingKey = `${pctEncode(creds.consumerSecret)}&${pctEncode(
    creds.tokenSecret,
  )}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const header: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(header[k])}"`)
      .join(", ")
  );
}

// Node's webcrypto/randomUUID is always available on Node 18+.
function makeNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Post a tweet. Returns a structured result; never throws. */
export async function postTweet(text: string): Promise<TweetResult> {
  const creds = readCreds();
  if (!creds) {
    console.log(`[x] (no keys — dry run)\n${text}`);
    return { ok: false, dryRun: true, error: "no-keys" };
  }

  const url = "https://api.twitter.com/2/tweets";
  const authorization = oauth1Header({
    method: "POST",
    url,
    creds,
    nonce: makeNonce(),
    timestamp: Math.floor(Date.now() / 1000),
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    // X's remaining-quota headers are the only visibility into the (small)
    // free-tier write budget — log them so "the account went quiet" is
    // diagnosable from PM2 logs instead of invisible.
    const remaining =
      res.headers.get("x-app-limit-24hour-remaining") ??
      res.headers.get("x-user-limit-24hour-remaining") ??
      res.headers.get("x-rate-limit-remaining");
    if (remaining != null && Number(remaining) <= 5) {
      console.warn(`[x] write quota low: ${remaining} remaining in window`);
    }

    if (res.ok) {
      const j = (await res.json().catch(() => null)) as
        | { data?: { id?: string } }
        | null;
      return { ok: true, id: j?.data?.id };
    }

    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      const reset =
        res.headers.get("x-app-limit-24hour-reset") ??
        res.headers.get("x-user-limit-24hour-reset") ??
        res.headers.get("x-rate-limit-reset");
      const mins = reset
        ? Math.max(0, Math.round((Number(reset) * 1000 - Date.now()) / 60_000))
        : null;
      console.warn(
        `[x] rate limited (429)${mins != null ? ` — resets in ~${mins}m` : ""}:`,
        body.slice(0, 200),
      );
      return { ok: false, rateLimited: true, error: "rate-limited" };
    }
    // X returns 403 with a duplicate-content detail for repeat text.
    if (/duplicate/i.test(body)) {
      console.warn("[x] duplicate content — skipping");
      return { ok: false, duplicate: true, error: "duplicate" };
    }
    console.error(`[x] post failed ${res.status}:`, body.slice(0, 300));
    return { ok: false, error: `http-${res.status}` };
  } catch (e) {
    console.error("[x] post error:", e);
    return { ok: false, error: "network" };
  }
}

/** True when all four X keys are present (channel is live, not dry-run). */
export function twitterConfigured(): boolean {
  return readCreds() !== null;
}
