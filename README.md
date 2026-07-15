# ApeWise.ai

Premium dark marketing landing page for **ApeWise** — a Solana-first memecoin
**smart-money tracker**. It scores profitable on-chain wallets and alerts users in
real time, with wallet segmentation (Smart 🟢 / Sniper ⚡ / Insider 🔴 / KOL 🎤),
anti-rug fusion, and Telegram-native delivery in multiple languages.
Independent brand, **powered by Fourtis**.

> **Scope:** landing page only. Product data (feed, stats) is **illustrative** and clearly
> labelled *private beta*. The waitlist endpoint **persists signups to a durable local JSONL
> file** (and optionally forwards to a webhook). Remaining mocks are marked `// TODO`.

---

## Tech stack

- **Next.js (App Router)** + **TypeScript** (strict)
- **Tailwind CSS** with design tokens exposed as CSS variables in `globals.css`
- **Framer Motion** for scroll reveals + micro-interactions (respects `prefers-reduced-motion`)
- **lucide-react** for icons
- Fonts: **Clash Display** (display) + **Satoshi** (body) + **JetBrains Mono** (data)

---

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run build        # production build
npm start            # run the production server (Node, port 3000)
npm run lint         # eslint
```

---

## Environment variables

Copy `.env.example` to `.env.local` (or set in your host):

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | recommended | Absolute base URL for canonical / OG / sitemap. Defaults to `https://apewise.ai`. |
| `WAITLIST_WEBHOOK_URL` | optional | If set, `/api/waitlist` also forwards each validated signup here (e.g. Sheets/Zapier/CRM). |
| `WAITLIST_FILE` | optional | Path to the durable JSONL file every signup is appended to. Defaults to `./data/waitlist.jsonl` (gitignored, survives restarts + deploys). |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | optional | Set to your site domain (e.g. `apewise.ai`) to enable privacy-friendly Plausible analytics + the `Waitlist Signup` goal. |

The app runs fine with **no env vars** for local dev.

---

## Project structure

```
src/
├── app/
│   ├── layout.tsx            # root layout: SEO metadata, JSON-LD, fonts, providers
│   ├── page.tsx              # composes all sections
│   ├── globals.css           # design tokens (CSS vars) + background system + base
│   ├── icon.svg              # favicon (file convention)
│   ├── sitemap.ts / robots.ts
│   ├── privacy/ · terms/     # placeholder legal pages
│   └── api/waitlist/route.ts # POST stub (validate → log → 200)
├── components/               # one component per section + Background/Brand/JsonLd
│   └── ui/                   # primitives: Button, GlassCard, Badge, Reveal, SectionHeading
├── lib/
│   ├── strings.tsx           # StringsProvider + useStrings() hook (deep-merge fallback)
│   ├── mock.ts               # mock feed/segments  // TODO real data
│   ├── site.ts               # URLs / handles / brand constants
│   └── cn.ts
└── locales/                  # en.ts (default) + id/ru/ar/zh scaffolds
```

### Design tokens

All tokens live as CSS variables in `src/app/globals.css` (`--bg`, `--surface`,
`--accent`, `--accent-2`, `--radius`, fonts, …) and are surfaced to Tailwind via
`tailwind.config.ts` (`bg-bg`, `text-accent`, `rounded-2xl`, `font-display`, …).

### Brand assets

The logo is an **"AW" monogram** — the `A` (peak + crossbar) flows into a `W`
zig-zag and resolves on the smart-money signal dot, in **premium emerald** (a
`--brand-hi → --brand-lo` gradient) on a **pure-black, borderless tile** with a
soft emerald glow. The same emerald is the UI accent (`--accent`) too — CTAs,
links, badges, pulses, glows and focus states — premium green on black. Single
source of truth: `<ApeWiseMonogram />` / `<BrandLockup />` in
`src/components/Brand.tsx` (token-driven). Standalone files for press / external use:

- `public/monogram.svg` — the mark on its own.
- `public/logo.svg` — horizontal lockup (monogram + wordmark).
- `src/app/icon.svg` — favicon: a simplified `A↗` variant that stays legible at 16 px.
- `public/social/x-avatar.{svg,png}` — X profile picture (400×400, circle-safe).
- `public/social/x-banner.{svg,png}` — X header (1500×500); content kept clear of the
  bottom-left avatar overlap. PNGs render the wordmark in Space Grotesk (Clash Display stand-in).

### Copy & i18n

All user-facing copy lives in `src/locales/en.ts` — no hardcoded strings in
components. `useStrings()` returns the active dictionary; non-EN locales are typed
`DeepPartial<Strings>` and **deep-merged over EN**, so partial translations fall
back to English automatically. `ar` flips the document to `dir="rtl"`.
The app ships **EN**; `id` / `ru` / `ar` / `zh` are scaffolded (`// TODO` complete).

### Fonts

Loaded via `<link rel="preconnect">` + `<link rel="stylesheet">` in the root
layout `<head>` (Fontshare + Google) — fetched in parallel so they don't block
first paint (CSS `@import` did). The licensed `woff2` files aren't bundled. To
self-host for best performance + zero layout shift, drop the woff2 files in
`src/app/fonts/`, switch to `next/font/local`, and remove the `<link>` tags.

### Mock data & stubs (replace before launch)

- `src/lib/mock.ts` — Smart Money Feed generator. `// TODO` real on-chain stream.
- `src/app/api/waitlist/route.ts` — validates + persists to `data/waitlist.jsonl` (+ optional webhook). `// TODO` move to a real DB/CRM at scale.
- `public/og.svg` — placeholder social image. `// TODO` replace with a 1200×630 PNG.

---

## Deploy to VPS

The app runs as a **Node server** (`next start`) behind Nginx — required for the
`/api/waitlist` route, so **do not** use `output: 'export'`.

First-time setup (Ubuntu 22.04/24.04, run over SSH):

```bash
# Node 20 + Nginx + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm i -g pm2

# from /var/www/apewise (rsync or git clone the repo here)
npm ci
npm run build
pm2 start npm --name apewise -- start
pm2 save && pm2 startup        # run the printed command for boot persistence
```

Nginx reverse proxy (`/etc/nginx/sites-available/apewise`) → `proxy_pass http://127.0.0.1:3000;`,
then `certbot --nginx -d apewise.ai -d www.apewise.ai` for SSL. Full step-by-step
lives in the deploy handoff.

### Redeploy

A one-shot redeploy script is included as [`deploy.sh`](./deploy.sh):

```bash
./deploy.sh        # git pull → npm ci → npm run build → pm2 reload apewise
```

---

## MVP — smart-money engine (Solana via Helius)

The `/terminal` runs in **DEMO** mode until the engine is wired. Then tracked-wallet
swaps flow in, the terminal goes **LIVE**, and Telegram alerts fire.

**Flow:** curated wallets → Helius enhanced webhook → `POST /api/ingest/helius`
→ parse swap → store + alert `@apewisesignals` → `/terminal` polls `GET /api/terminal/feed`.

**Setup (on the server):**

1. Pick the wallets to track:
   ```bash
   cp smart-wallets.example.json data/smart-wallets.json   # then edit addresses + segments
   ```
2. Set env (`.env`): `HELIUS_API_KEY`, `INGEST_SECRET`, `WEBHOOK_URL`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SIGNALS_CHAT_ID` (bot must be admin of the channel),
   optional `BUY_LINK_TEMPLATE`. Restart: `pm2 restart apewise`.
3. Register the webhook (one-off):
   ```bash
   node scripts/setup-helius-webhook.mjs
   ```

**Verify locally** with a sample payload (no Helius needed):
```bash
curl -s -X POST "http://localhost:3000/api/ingest/helius?secret=$INGEST_SECRET" \
  -H 'content-type: application/json' --data @sample/helius-swap.json
curl -s http://localhost:3000/api/terminal/feed | head   # -> "live":true with the event
```

> **Scope:** wallets are operator-curated (segments assigned per wallet). Automated
> PnL/win-rate **scoring**, anti-rug fusion and payments are the next milestones —
> see `// TODO`s in `src/lib/server/`.

---

## Auto-tweet channel (X / Twitter) — Moby-style, but strict

An optional **auto-poster** that tweets smart-money buys in the style of *Whale
Watch by Moby* (`🐳 A smart-money whale just bought $25K of $PEPE at $2M MC`), but
built to **under-post**. Over-tweeting low-signal noise tanks reach, so it only
ever emits the **single highest-conviction buy per tick**, and only from
**high-win-rate wallets** that clear a strict gate.

**Design — detection and posting are decoupled** so bursty on-chain activity can
never become bursty tweets:

```
Helius webhook → parse → enrich → store → enqueueForTweet()  ┐  (fast pre-filter)
                                                             ▼
tweet worker → GET /api/tweets/dispatch → dispatchTweets()   →  post ≤ 1 tweet
   • global pacing: min spacing + rolling per-hour / per-day caps
   • per-token & per-wallet+token cooldowns
   • strict per-event gate + high-win-rate wallet gate
   • conviction score → tweet only the best candidate in the pool
```

Every gate lives in `src/lib/server/tweets.ts`; the X API v2 client (OAuth 1.0a,
zero-dep) is in `src/lib/server/twitter.ts`. Rate-limit state persists to
`data/tweets.jsonl`, so a restart can't cause a post burst.

**The gate (all must pass):** buy only · size `≥ TWEET_MIN_USD` · anti-rug `ok`
(a known rug is always blocked) · liquidity / market-cap band · min token age ·
allowed segment (`smart,insider` by default) · **observed win-rate
`≥ TWEET_MIN_WIN_RATE`** (with a min number of closed round-trips) · conviction
`≥ TWEET_MIN_CONVICTION`. Then the global limiter (`TWEET_MIN_SPACING_SEC`,
`TWEET_MAX_PER_HOUR`, `TWEET_MAX_PER_DAY`) and cooldowns decide whether *this
tick* posts at all. See `.env.example` for every knob.

**Setup (on the server):**

1. Create X API keys (developer.x.com → app → **Read and Write**, then regenerate
   the Access Token so it inherits write) and set `TWITTER_API_KEY`,
   `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`. With the
   keys blank the channel stays in **dry-run** (composes + logs, never posts).
2. Run the worker alongside the app:
   ```bash
   pm2 start scripts/tweet-worker.mjs --name apewise-tweets && pm2 save
   ```
3. Tune strictness in `.env` (all `TWEET_*` vars) and `pm2 restart apewise`.

> The tweet gate is intentionally **much stricter** than the Telegram alert gate —
> Telegram is a firehose for subscribers; the public timeline is curated so the
> account reads as high-signal, which is what keeps its reach healthy.

---

## Runbook — the bot went quiet (no TG posts, no tweets)

Both channels share one upstream: **ingested swap events**. If ingestion dies,
Telegram *and* X stop together. If only one channel stops, its credentials/caps
died. Diagnose in one command **on the server**:

```bash
node scripts/doctor.mjs        # checks every link end-to-end, prints ❌ + the fix
```

It verifies: wallet files → Helius webhook state (registered? address list in
sync? authHeader = INGEST_SECRET?) → RPC reachability/throttling → data
freshness (`events.jsonl` / `tweets.jsonl`) → Telegram token + channel admin
rights → X credentials (401/403 = dead keys, 429 UsageCap = monthly cap) → the
running app's `/api/health` verdict.

**The usual suspects, most common first:**

1. **Webhook/wallet drift** — `source-wallets.mjs` rewrote
   `data/tracked-wallets.json` but the Helius webhook still watches the *old*
   addresses → every delivery is filtered out (`parsed=0`). `source-wallets`
   now auto-syncs the webhook when `HELIUS_API_KEY`+`WEBHOOK_URL` are set;
   otherwise re-run `node scripts/setup-helius-webhook.mjs` after re-sourcing.
2. **Public RPC throttling (Mode B)** — `api.mainnet-beta.solana.com`
   429-blocks VPS IPs; every poll silently returned nothing. The poller now
   ships with a keyless failover trio by default, rotates endpoints when a
   cycle is mostly throttled, widens call spacing adaptively (×2 per bad
   cycle, up to ×8), and `/api/health` reports `rpc-dead`. If you keep seeing
   `[rpc-poll] throttled:` lines, put a free **keyed** RPC first in
   `SOLANA_RPC_URLS` (a Helius/Triton free key gets a far higher limit than
   any keyless endpoint) and consider `RPC_CALL_DELAY_MS=300`,
   `RPC_MAX_WALLETS=30`, `RPC_POLL_INTERVAL_SEC=60` to stay under free-tier
   limits.
3. **X keys/caps** — regenerated keys, app suspended, tokens created before
   Read+Write, or the **monthly post cap** (free tier ≈ 500 posts/mo — Moby
   mode can burn that in a day or two, then every post 429s until the month
   resets). Now surfaced as `x-auth-failed` / `x-usage-capped` in `/api/health`
   instead of being silently swallowed.
4. **Telegram rights** — bot demoted / kicked from the channel, or a revoked
   token: sends fail with 401/403. Now tracked (`telegram-failing`), and flood
   control (429) is retried with the API's `retry_after`.
5. **Empty wallet set** — all sources failed and the data files are gone;
   nothing can be detected. Now logged loudly + flagged `wallets-empty`.
6. **Env changed but PM2 kept the old env** — after editing `.env`, restart
   with `pm2 restart apewise --update-env` (a plain `reload` keeps old env).

**So it never happens silently again**, run the watchdog worker — it polls
`GET /api/health` and DMs you on Telegram the moment the pipeline degrades
(and again when it recovers):

```bash
# .env: TELEGRAM_ADMIN_CHAT_ID=<your chat id with the bot>   (ask @userinfobot)
pm2 start scripts/watchdog.mjs --name apewise-watchdog && pm2 save
```

`GET /api/health?secret=$INGEST_SECRET` returns
`{ status: ok|degraded|stalled, problems: [...], health: {...} }` with per-stage
counters (ingest heartbeat, wallet count, RPC cycle stats, TG/X success/failure
streaks + last error, tweet-dispatch pool/block reason) — see
`src/lib/server/health.ts`.
