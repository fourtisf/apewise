#!/usr/bin/env node
/**
 * ApeWise RPC proxy — your "own RPC" without running a $500+/mo Solana node.
 *
 * A tiny local JSON-RPC front that multiplies effective free-tier capacity:
 *   1. AGGREGATES many upstream RPCs into one endpoint (round-robin + failover;
 *      an upstream that 429s is benched for a cooldown instead of retried).
 *   2. CACHES getTransaction FOREVER (a confirmed transaction is immutable —
 *      refetching it is pure waste; restarts/lookback re-scans become free).
 *   3. Micro-caches getSignaturesForAddress (default 15s ≈ the poll cadence),
 *      so overlapping scans don't double-bill the same wallet.
 *
 * Run under PM2 next to the app:
 *   pm2 start scripts/rpc-proxy.mjs --name apewise-rpcproxy && pm2 save
 * Then point the app at it in .env and restart:
 *   SOLANA_RPC_URL=http://127.0.0.1:8787
 *   pm2 restart apewise --update-env
 *
 * Env:
 *   RPC_PROXY_PORT           listen port (default 8787, localhost only)
 *   RPC_PROXY_UPSTREAMS      comma list of real RPC URLs (recommended: a few
 *                            free keyed ones — Alchemy/Syndica/Chainstack —
 *                            plus keyless publicnode/drpc). Falls back to
 *                            SOLANA_RPC_URLS, then a keyless default trio.
 *   RPC_PROXY_TX_CACHE       max cached transactions (default 3000)
 *   RPC_PROXY_SIGS_TTL_MS    signatures cache TTL (default 15000)
 *   RPC_PROXY_COOLDOWN_MS    bench time for a 429'd upstream (default 30000)
 *
 * GET /health returns per-upstream + cache stats (used by doctor/watchdog).
 */
import http from "node:http";
import { loadEnv } from "./lib/env.mjs";
await loadEnv();

const PORT = Number(process.env.RPC_PROXY_PORT) || 8787;
const TX_CACHE_MAX = Number(process.env.RPC_PROXY_TX_CACHE) || 3000;
const SIGS_TTL = Number(process.env.RPC_PROXY_SIGS_TTL_MS) || 15_000;
const COOLDOWN_MS = Number(process.env.RPC_PROXY_COOLDOWN_MS) || 30_000;

const DEFAULT_UPSTREAMS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
];

function upstreams() {
  const own = (process.env.RPC_PROXY_UPSTREAMS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const shared = (process.env.SOLANA_RPC_URLS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const list = own.length ? own : shared.length ? shared : DEFAULT_UPSTREAMS;
  // Never call ourselves: drop anything that points at this proxy.
  return list.filter((u) => !/(127\.0\.0\.1|localhost)/.test(u) || !u.includes(String(PORT)));
}

const UP = upstreams().map((url) => ({
  url,
  ok: 0,
  fail: 0,
  benchedUntil: 0, // 429/5xx puts an upstream on the bench for COOLDOWN_MS
}));
if (UP.length === 0) {
  console.error("rpc-proxy: no upstreams configured");
  process.exit(1);
}

let rr = 0;
const stats = { requests: 0, txCacheHits: 0, sigsCacheHits: 0, upstreamErrors: 0 };

// getTransaction results are immutable → simple LRU (Map preserves insertion
// order; re-inserting on hit keeps hot entries alive).
const txCache = new Map();
// getSignaturesForAddress: short-TTL cache keyed by the full params.
const sigsCache = new Map();

function cacheGetTx(key) {
  const hit = txCache.get(key);
  if (hit === undefined) return undefined;
  txCache.delete(key);
  txCache.set(key, hit);
  return hit;
}
function cacheSetTx(key, value) {
  txCache.set(key, value);
  if (txCache.size > TX_CACHE_MAX) txCache.delete(txCache.keys().next().value);
}

async function callUpstream(u, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(u.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    if (res.status === 429 || res.status >= 500) {
      u.fail++;
      u.benchedUntil = Date.now() + COOLDOWN_MS;
      return null;
    }
    if (!res.ok) {
      u.fail++;
      return null;
    }
    const text = await res.text();
    u.ok++;
    return text;
  } catch {
    u.fail++;
    u.benchedUntil = Date.now() + COOLDOWN_MS;
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Try every upstream once, starting round-robin, skipping benched ones. */
async function forward(body) {
  const now = Date.now();
  const order = [];
  for (let i = 0; i < UP.length; i++) order.push(UP[(rr + i) % UP.length]);
  rr = (rr + 1) % UP.length;
  // Benched upstreams go last (still tried if everyone else is benched too).
  order.sort((a, b) => (a.benchedUntil > now ? 1 : 0) - (b.benchedUntil > now ? 1 : 0));
  for (const u of order) {
    const text = await callUpstream(u, body);
    if (text !== null) return text;
    stats.upstreamErrors++;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      ...stats,
      txCacheSize: txCache.size,
      upstreams: UP.map((u) => ({
        url: u.url.replace(/api-key=[^&]+|\/v2\/[A-Za-z0-9_-]+/g, "…"), // don't leak keys
        ok: u.ok,
        fail: u.fail,
        benched: u.benchedUntil > Date.now(),
      })),
    }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
  req.on("end", async () => {
    stats.requests++;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* pass through unparsed (batch or junk) */
    }
    const method = parsed && !Array.isArray(parsed) ? parsed.method : null;
    const send = (text, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(text);
    };
    const fail = () =>
      send(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed?.id ?? 1,
        error: { code: -32000, message: "all upstreams failed" },
      }), 502);
    // Cached JSON has the ORIGINAL request's id — rewrite it for this caller.
    const withId = (text) => {
      try {
        const j = JSON.parse(text);
        j.id = parsed?.id ?? 1;
        return JSON.stringify(j);
      } catch {
        return text;
      }
    };

    if (method === "getTransaction") {
      const key = JSON.stringify(parsed.params);
      const hit = cacheGetTx(key);
      if (hit) {
        stats.txCacheHits++;
        return send(withId(hit));
      }
      const text = await forward(raw);
      if (text === null) return fail();
      // Only cache a real result — a null result can mean "not yet available".
      try {
        if (JSON.parse(text)?.result) cacheSetTx(key, text);
      } catch { /* don't cache unparseable */ }
      return send(text);
    }

    if (method === "getSignaturesForAddress") {
      const key = JSON.stringify(parsed.params);
      const hit = sigsCache.get(key);
      if (hit && Date.now() - hit.at < SIGS_TTL) {
        stats.sigsCacheHits++;
        return send(withId(hit.text));
      }
      const text = await forward(raw);
      if (text === null) return fail();
      sigsCache.set(key, { at: Date.now(), text });
      if (sigsCache.size > 2000) {
        for (const [k, v] of sigsCache) {
          if (Date.now() - v.at > SIGS_TTL) sigsCache.delete(k);
        }
      }
      return send(text);
    }

    // Everything else: plain pass-through with failover.
    const text = await forward(raw);
    if (text === null) return fail();
    return send(text);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `ApeWise RPC proxy on http://127.0.0.1:${PORT} → ${UP.length} upstream(s):\n` +
      UP.map((u) => `  - ${u.url.replace(/api-key=[^&]+|\/v2\/[A-Za-z0-9_-]+/g, "…")}`).join("\n") +
      `\nPoint the app here:  SOLANA_RPC_URL=http://127.0.0.1:${PORT}`,
  );
});
