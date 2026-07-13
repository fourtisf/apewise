# Audit: why ApeWise rarely tweets / rarely posts to the Telegram channel

Scope: full read of the posting pipeline on `main` — ingest (Helius webhook + RPC poll),
enrichment, store/dedup, Telegram alerts, the auto-tweet gate/dispatcher, the PM2 workers,
and the setup/deploy scripts. All 42 unit tests pass; every issue below lives in a path the
tests do not cover (live polling, worker env, Telegram sends, gate interplay).

**Verdict: yes — several real bugs compound into "the account barely posts", on top of
deliberately strict gating.** Both channels fire from the same ingested events, so the
dominant failure mode is **ingest starvation**: very few `SmartEvent`s are created at all,
and the few that exist are then thinned further by gates and silent send failures.

Findings are ranked by expected impact.

---

## A. Ingest starvation — the pipeline sees far fewer swaps than reality

### A1. RPC poller permanently drops swaps whenever the RPC throttles (bug, critical)
`src/lib/server/solanaRpc.ts:251` — the per-wallet cursor is advanced to the newest
signature **before** the `getTransaction` fetches run:

```ts
seen.set(w, newest);          // cursor already moved…
...
const tx = await rpc(...);    // …but this returns null on 429/timeout
if (!tx) continue;            // swap silently skipped FOREVER
```

`rpc()` (`solanaRpc.ts:151-170`) swallows every error (`!res.ok → null`, catch → null).
The free `api.mainnet-beta.solana.com` endpoint 429s constantly at this call rate
(60 wallets × several calls per cycle at 150 ms spacing ≈ 7 rps sustained). Every throttled
`getTransaction` is a tracked-wallet swap that never becomes an event — no alert, no tweet,
no log. This alone can eat the majority of signals in RPC-poll mode.

Fix: only advance the cursor past signatures that were successfully fetched and parsed
(or re-queue failures), and log RPC failure counts per cycle.

### A2. Active wallets lose everything beyond the newest 10 signatures (bug)
`solanaRpc.ts:234-237` fetches `{ limit: perWallet }` (default 10) and never passes
`until: <cursor>`. With the rotating window a wallet is only polled every few minutes; a
busy wallet easily does >10 txs in that gap. When the cursor signature is not inside the
newest 10, the loop treats only those 10 as fresh — everything older is lost. Use the RPC's
`until` parameter to page down to the cursor.

### A3. Rotating window iterates a churning wallet list (bug)
`pollTrackedWallets` re-resolves `getSmartWallets()` every cycle (`solanaRpc.ts:193-219`);
that list merges live Birdeye/GMGN leaderboards whose contents/order change every 5 min
(cache TTL). `pollOffset % total` then indexes into a *different* array each refresh, so
wallets are skipped or double-polled nondeterministically. Snapshot the list (or sort it
stably) and key the rotation on wallet address, not array position.

### A4. Helius mode: the webhook wallet set is frozen at setup time (design gap, critical over time)
`scripts/setup-helius-webhook.mjs` registers `accountAddresses` once. Memecoin smart-money
wallets go cold within days–weeks. Unless sourcing + webhook re-registration is re-run on a
schedule, deliveries decay toward zero — the classic "it posted a lot at first, now barely"
signature. There is also no heartbeat: if Helius disables the webhook or credits run out,
nothing notices. Add a cron (e.g. weekly `source-wallets.mjs` + `setup-helius-webhook.mjs`)
and a "no events ingested in N hours" alarm.

### A5. Every restart/deploy wipes in-memory pipeline state (bug)
The tweet candidate pool (`src/lib/server/tweets.ts:76`), RPC cursors + `initialized`
(`solanaRpc.ts:177-181`), and alert cooldowns (`alerts.ts:173-174`) are module-level memory.
`deploy.sh` reloads the app on every deploy; PM2 restarts do the same. Consequences:
queued-but-not-yet-tweeted candidates are lost; every wallet re-baselines with only a
20-minute lookback (`RPC_LOOKBACK_MIN`). Persist the pool and cursors like `tweets.jsonl`
already does for post history.

---

## B. The workers can be silently dead (config foot-gun — check this FIRST on the VPS)

### B1. PM2 workers do not read `.env.local` (bug, potentially total X outage)
`scripts/tweet-worker.mjs`, `alert-worker.mjs` and `rpc-poll-worker.mjs` read only
`process.env`. Plain `node` never loads `.env.local` — only Next does; the repo already
knows this: `scripts/source-wallets.mjs:33-40` ships its own `.env.local` loader for exactly
this reason, but the three long-running workers never got it.

If `INGEST_SECRET` (or a non-default `PORT`) lives only in `.env.local`:
- every worker request hits `/api/.../dispatch` **without** the secret → 401;
- `/api/tweets/dispatch` is the ONLY thing that ever posts a tweet → **X never posts**;
- and per B2 below, you get zero log evidence.

### B2. tweet/alert workers log nothing on failure responses (bug)
`tweet-worker.mjs:23` and `alert-worker.mjs:20` only do `if (j.posted) console.log(...)`.
A 401/500 response has no `posted` field → the tick is completely silent. The rpc worker
does log `j.ok === false`; the other two must too.

### B3. `deploy.sh` reloads only the `apewise` app process
Workers (`apewise-tweets`, `apewise-alerts`, `apewise-rpc`) keep running old code after
every deploy until someone remembers `pm2 restart`. Reload them in `deploy.sh`.

Note: `alert-worker` being a no-op is *by design* — `/api/alerts/dispatch` returns 0 unless
`ALERTS_MARKET_FALLBACK=true` (`src/lib/server/dispatch.ts:19`); Telegram alerts are sent
inline at ingest. So "the alert worker is running" tells you nothing about TG posting.

---

## C. Tweet gate blocks more than intended

### C1. Enrichment runs once at ingest; a transient failure permanently disqualifies the event (bug)
`enrichEvent` fills mcap/liquidity from DexScreener with a 2.5 s timeout and no retry
(`market.ts:21-40,103-140`); a failed lookup is even cached for 60 s as an empty entry. The
tweet `hardGate` then blocks `liquidityUsd == null` (`tweetGate.ts:265-268`, reason
`low-liq`) and — in strict mode — `marketCapUsd == null` (`no-mcap`). The event sits in the
pool for its whole TTL but can never pass; Telegram still posts it (no liq gate there).
This exactly produces "Telegram posted it, X did not". Re-enrich at dispatch time when the
gated fields are missing.

### C2. Moby mode still hard-blocks observed wallets with pnl ≤ 0 (bug)
`walletGate` (`tweetGate.ts:242-244`): an observed wallet passes only if
`winRate >= minWinRate && pnlUsd > 0`. `TWEET_MOBY_MODE=true` sets `minWinRate=0`
("no win-rate gate") but the `pnlUsd > 0` condition still applies. The PnL proxy
(`score.ts`) is `sell USD − buy USD` over the *partially observed* window, so a wallet that
is accumulating (buys > sells so far) looks deeply negative and is silently blocked — and
because `observed` flips true once 4 closed round-trips accumulate
(`walletQuality.ts:28-29`), **more wallets get muted the longer the system runs**. Another
"quiet over time" mechanism. When `minWinRate` is 0, skip the wallet-quality block entirely.

### C3. Strict defaults are close to "never tweet" (documented behavior, not a bug — but verify prod env)
With `TWEET_MOBY_MODE` unset: buy ≥ $5k AND liq ≥ $20k AND $100k ≤ mcap ≤ $50M AND
anti-rug verdict strictly `ok` (RugCheck marks most young memecoins `caution` — 3 of 4
alerts in the operator's screenshot are ⚠️ caution, i.e. un-tweetable) AND win-rate ≥ 60
AND conviction ≥ 55 AND 24 h per-token cooldown. The live X feed shows a $9.14 B-MC tweet,
which strict mode's $50 M cap would block — so prod is presumably Moby mode; make sure that
env var survives restarts/deploys, or the account silently flips to near-mute defaults.

---

## D. Telegram-specific silent drops

### D1. Unescaped HTML in alerts kills the message (bug)
`sendAlert` interpolates `ev.token`, `ev.label` and social URLs into `parse_mode: "HTML"`
text without escaping (`alerts.ts:243-262`). Solana token symbols are arbitrary strings; any
`&`, `<`, `>` (e.g. `M&M`, `<3`) makes Telegram return 400 "can't parse entities" → alert
dropped with only a console line. The tweet mirror path already escapes
(`tweets.ts:119-120` `escHtml`) — `sendAlert` must too.

### D2. Failed sends are never retried (bug)
`sendAlert` ignores `postToChannel`'s boolean; the event was already committed by
`addEvents`, so a TG 429 (channel rate limit) or transient network error = alert lost
forever. Add a small retry/queue, honoring Telegram's `retry_after`.

---

## E. External ceilings worth knowing (not code bugs)

- **X API free tier ≈ 500 writes/month (~17/day).** Moby mode's `maxPerDay=400` will slam
  into it; 429s keep the candidate but the 20-min pool TTL then expires it, so long X
  rate-limit windows read as a quiet account. Log `x-rate-limit-remaining` from responses.
- The free public Solana RPC's per-IP limits are the binding constraint for Mode B — a paid
  RPC (or Helius webhook mode with A4 fixed) changes the ingest volume dramatically.

## Minor notes

- `INGEST_SECRET` is compared with `===` (not timing-safe) and accepted as a `?secret=`
  query param, which lands in access logs.
- `store.ts` rebuilds `seen` from the 2000-event ring buffer, so very old events can
  re-ingest after enough volume (low impact today).
- Cooldown maps in `alerts.ts` grow unbounded (memory only).

---

## Recommended order of attack

1. **On the VPS, verify B1/B2 right now**: `curl "localhost:3000/api/tweets/dispatch"`
   with and without the secret; `pm2 logs apewise-tweets`. If it's 401, that alone explains
   a mostly-silent X account.
2. Check ingest volume: `wc -l data/events.jsonl` growth per hour; run
   `node scripts/verify-dedup.mjs`.
3. Fix A1 + A2 (cursor/`until`) — biggest signal recovery in RPC mode.
4. Add the `.env.local` loader + failure logging to the three workers; reload workers in
   `deploy.sh`.
5. Fix C1 (re-enrich at dispatch) and C2 (skip wallet gate when `minWinRate=0`).
6. Escape + retry Telegram sends (D1/D2).
7. Cron the wallet re-source + webhook re-registration; add a "no events in N hours" alarm.
