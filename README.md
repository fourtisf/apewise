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

### Copy & i18n

All user-facing copy lives in `src/locales/en.ts` — no hardcoded strings in
components. `useStrings()` returns the active dictionary; non-EN locales are typed
`DeepPartial<Strings>` and **deep-merged over EN**, so partial translations fall
back to English automatically. `ar` flips the document to `dir="rtl"`.
The app ships **EN**; `id` / `ru` / `ar` / `zh` are scaffolded (`// TODO` complete).

### Fonts

Loaded via `@import` (Fontshare + Google) at the top of `globals.css` because the
licensed `woff2` files aren't bundled. To self-host for best performance, drop the
woff2 files in `src/app/fonts/`, switch to `next/font/local`, and remove the
`@import` lines.

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
