# OPHT ETF Tracker — Cloudflare Migration Design

**Date:** 2026-10-05
**Status:** Approved in chat, pending spec review
**Repo:** jwebking/opht-etf-cloudflare (seeded from jwebking/Ophthalmology-Sector-ETF, remote `upstream`)

## Goal

Run the existing OPHT index tracker on Cloudflare as cheaply as possible (target: $0/month on the
Workers Free plan), with feature parity to the current Replit app, on an architecture that phase 2
(earnings transcripts / filings Q&A) can extend without a rewrite.

## Non-goals (this phase)

- UI or feature changes. The page, theme, charts, 3 weighting modes, ticker list and API response
  shapes stay identical.
- Custom domain (starts on `*.workers.dev`; domain can be attached later in the dashboard).
- Phase 2 features (R2 document storage, Vectorize, LLM Q&A). Only noted under Future.

## Current system (what we are replacing)

- React 18 + Vite + Tailwind + shadcn/ui + lightweight-charts SPA (`client/`).
- Express 5 server (`server/`) with helmet, express-rate-limit, Drizzle ORM on Neon Postgres.
- Data: Yahoo Finance chart API (10y daily adjusted close for 26 OPHT tickers + SPY, VTI);
  market caps from FMP (if `FMP_API_KEY`) else Yahoo.
- Seeding and the daily update are triggered from server startup.
- Front end calls only `GET /api/status`, `GET /api/chart-data`, `GET /api/holdings`; all index math
  is client-side (`client/src/lib/indexCalculations.ts`).

## Architecture

A single Cloudflare Worker with static assets:

| Piece | Cloudflare product | Purpose |
|---|---|---|
| Static SPA | Workers static assets | Vite build output served directly (no Worker CPU used) |
| API | Worker `fetch` handler | `/api/*` routes |
| Source of truth | D1 (`opht-db`) | tickers, price_history, market_caps, data_status |
| Read cache | KV (`CHART_CACHE`) | One pre-serialized JSON array per symbol: `prices:<SYMBOL>` |
| Daily update | Cron Triggers | Incremental price + market-cap refresh |
| Deploys | Workers Builds (GitHub integration) | Push to `main` deploys |

Assets config uses `not_found_handling: "single-page-application"` and `run_worker_first: ["/api/*"]`
so only API calls invoke the Worker.

### Repository layout

```
src/client/            existing React app (moved from client/), unused shadcn components removed
worker/index.ts        fetch handler + router for /api/*
worker/routes.ts       status, chart-data, holdings, admin/update handlers
worker/ingest.ts       Yahoo/FMP/Stooq fetch + parse (ported from server/fmp.ts)
worker/scheduled.ts    cron handler: batched incremental update
worker/tickers.ts      OPHT_TICKERS / BENCHMARK_TICKERS (single source, shared by seed script)
migrations/0001_init.sql
scripts/seed.ts        local one-time 10y backfill → SQL file → D1 + KV
wrangler.jsonc
vite.config.ts, tsconfig.json, package.json
tests/                 vitest unit tests
```

Removed: `server/`, `drizzle.config.ts`, `.replit`, `replit.md` (replaced by `README.md`),
Express/pg/drizzle/passport/session/helmet/rate-limit/ws deps, Replit Vite plugins.

## Data model (D1)

```sql
CREATE TABLE tickers (symbol TEXT PRIMARY KEY, company_name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'opht');
CREATE TABLE price_history (symbol TEXT NOT NULL, date TEXT NOT NULL, adj_close REAL NOT NULL, PRIMARY KEY (symbol, date));
CREATE TABLE market_caps (symbol TEXT PRIMARY KEY, market_cap REAL, last_updated TEXT);
CREATE TABLE data_status (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
```

The unused `users` table is dropped. Upserts use `INSERT ... ON CONFLICT DO UPDATE`.

## Data flow

### One-time backfill (`npm run seed`, runs on the developer's Mac)

1. For each of the 28 symbols, fetch Yahoo `range=10y&interval=1d` (500 ms spacing), plus market caps.
2. Write `seed/seed.sql` (batched multi-row INSERTs) and `seed/kv/<SYMBOL>.json`.
3. `wrangler d1 execute opht-db --remote --file seed/seed.sql`, then `wrangler kv bulk put` for the
   per-symbol JSON. Set `data_status.initial_seed = complete` and `last_update`.

Running locally avoids Yahoo blocking datacenter IPs and the Worker CPU limit for the large load.
`seed/` is gitignored. The same script with `--local` seeds the local dev D1/KV.

### Daily update (cron)

Cron: `30,35,40,45 22 * * 1-5` (weekdays after US close). Each run maps its minute to a batch
index (0–3) and processes 7 of the 28 symbols:

1. `SELECT MAX(date)` for the symbol; fetch Yahoo `period1=<latest+1d>` → upsert new rows.
   If Yahoo fails (non-2xx or unparsable), try Stooq daily CSV for the same window.
2. OPHT symbols only: refresh market cap (FMP if `FMP_API_KEY` is set, else Yahoo meta).
3. Re-read that symbol's full series from D1 and write `prices:<SYMBOL>` to KV
   (`[{"date":"YYYY-MM-DD","adjClose":n}, ...]`, ~70 KB each).
4. Last batch sets `data_status.last_update` to today's date.

Batching keeps each invocation under the Free plan's 50-subrequest limit (7 symbols × ≤3 fetches
+ D1/KV calls) and keeps per-invocation CPU small. KV writes: ≤28/day (limit 1,000).

### API (response shapes unchanged)

- `GET /api/chart-data` — reads the 28 `prices:*` KV values as text in parallel and concatenates
  them into `{"SYM":[...],...}` without JSON parsing (negligible CPU). Response header
  `Cache-Control: public, max-age=3600`. Symbols missing from KV are omitted.
- `GET /api/holdings` — `SELECT symbol, market_cap FROM market_caps`, merged with `OPHT_TICKERS`,
  sorted by market cap desc. Same shape: `[{symbol, companyName, marketCap}]`.
- `GET /api/status` — `{seeded, lastUpdate, seedInProgress: false}` from `data_status`.
- `POST /api/admin/update?batch=0..3|all` — requires `Authorization: Bearer <ADMIN_TOKEN>`; runs
  the same update logic as cron (for manual recovery). 404 if `ADMIN_TOKEN` is unset.

## Error handling

- A symbol whose fetch fails in both Yahoo and Stooq is logged and skipped. Because each run
  fetches from the symbol's latest stored date, the gap self-heals on the next successful run.
- KV for a symbol is only overwritten after its D1 write succeeds, so failures leave the
  previous day's data serving.
- API handlers return `{status:"error", message}` with 500 on unexpected errors (matching current
  behavior); errors are logged to Workers Logs (observability enabled in wrangler config).
- No app-level rate limiter (Express one removed); Cloudflare's edge plus the 1-hour cache on the
  heaviest route suffice for this traffic. Can add a WAF rate-limit rule later if needed.

## Configuration & secrets

- `wrangler.jsonc`: name `opht-etf`, `compatibility_date` current, assets dir `dist/client`,
  D1 binding `DB`, KV binding `CHART_CACHE`, cron triggers, `observability.enabled = true`.
- Secrets (optional): `FMP_API_KEY`, `ADMIN_TOKEN` via `wrangler secret put` or dashboard.

## One-time setup the user performs

1. `npx wrangler login`
2. `npx wrangler d1 create opht-db` and `npx wrangler kv namespace create CHART_CACHE`
   (IDs pasted into `wrangler.jsonc`; I will do this if the CLI is logged in).
3. `npx wrangler d1 migrations apply opht-db --remote`, then `npm run seed -- --remote`.
4. Dashboard → Workers & Pages → Create → Import a repository → `jwebking/opht-etf-cloudflare`
   (build command `npm run build`, deploy command `npx wrangler deploy`).

## Testing

- Vitest unit tests: Yahoo chart response parser, Stooq CSV parser, batch selection by cron
  minute, KV concatenation into the `chart-data` shape, holdings merge/sort.
- Local integration: `wrangler dev` with local D1/KV seeded via `npm run seed -- --local`; verify
  in the browser that the chart renders, all 3 weighting modes work, holdings table populates,
  light/dark toggle works, and mobile layout is intact.
- Post-deploy: `POST /api/admin/update?batch=all` once to prove Yahoo is reachable from
  Cloudflare and the cron path works; check Workers Logs.

## Cost

Expected $0/month on Workers Free (100k requests/day, D1 5 GB / 5M reads/day, KV 100k reads &
1k writes/day, 5 cron triggers). Main risk is the 10 ms CPU limit; the design keeps every
invocation well below it. Fallback: Workers Paid at $5/month.

## Risks

- **Yahoo blocks Cloudflare egress IPs.** Mitigation: Stooq fallback for daily updates; backfill runs
  locally. If both fail from Cloudflare, switch daily updates to FMP's EOD endpoint (requires key).
- **Yahoo API is unofficial** and could change shape. Parser is isolated and unit-tested.
- **OTC ADRs (CZMWY, HOCPY)** may be missing from Stooq; they'd rely on Yahoo only.

## Future (phase 2/3, not built now)

Upload earnings-call transcripts, 10-K/8-K/annual reports per company → R2. Chunk + embed
(Workers AI embeddings) → Vectorize index with `symbol`/`doc_type`/`period` metadata. A `/api/ask`
route does retrieval and calls an LLM (Workers AI or Claude API) with citations. An admin upload
page behind Cloudflare Access. D1 gains a `documents` table. Likely requires Workers Paid ($5/mo).
