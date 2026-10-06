# $OPHT — Ophthalmology Sector ETF Tracker

A mock, custom-built index of publicly traded ophthalmology companies. The chart compares it with SPY and VTI under three weightings: market cap, equal weight, and market cap capped at 25% per holding.

The app runs on **Cloudflare Workers** and is designed to stay within the free plan.

| Piece | Where |
|---|---|
| React front end (Vite, Tailwind, lightweight-charts) | `client/`, served as Workers static assets |
| API (`/api/status`, `/api/chart-data`, `/api/holdings`) | `worker/routes.ts` |
| Source of truth | D1 database `opht-db` (`migrations/`) |
| Read cache | KV namespace `CHART_CACHE`, one JSON array per symbol (`prices:<SYMBOL>`) |
| Daily update | Cron, weekdays 22:30–22:45 UTC, 4 batches of 7 symbols (`worker/update.ts`) |
| Ticker list | `worker/tickers.ts` |

Design and plan: `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## Local development

```bash
npm install
npm run seed -- --local          # applies migrations, pulls 10y of Yahoo prices, loads local D1 + KV
npm run preview                  # builds the front end and serves everything at http://localhost:8787
```

To work on the front end with hot reload, run `npm run dev:api` (Worker on :8787) and `npm run dev` (Vite, which proxies `/api` to the Worker) in two terminals.

Market caps come from FMP. Without them, the index line is empty in every weighting mode, because the front end ignores holdings with a market cap of 0. Pass your key to the seed script:

```bash
FMP_API_KEY=your_key npm run seed -- --local
```

For local manual updates, put `ADMIN_TOKEN=...` (and optionally `FMP_API_KEY=...`) in `.dev.vars`. That file is gitignored.

```bash
npm test          # unit tests (vitest)
npm run check     # typecheck front end + worker
```

## One-time Cloudflare setup

1. `npx wrangler login`
2. Create the resources and paste their IDs into `wrangler.jsonc`:
   `npx wrangler d1 create opht-db` and `npx wrangler kv namespace create CHART_CACHE`
3. Load production data: `FMP_API_KEY=... npm run seed -- --remote`
4. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → `jwebking/opht-etf-cloudflare`.
   Build command `npm run build`; deploy command `npx wrangler deploy`. After this, every push to `main` deploys.
5. Worker → Settings → Variables and Secrets: add `FMP_API_KEY` (keeps market caps fresh) and `ADMIN_TOKEN` (enables manual updates).

## Manual update

The cron handles daily updates. To run a batch by hand (for example after an outage), call the admin endpoint. Batches are `0`–`3`, 7 symbols each, to stay under the free plan's 50-subrequest limit. Batch `3` also records the update date.

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://<your-worker>.workers.dev/api/admin/update?batch=0"
```

## Notes

- Prices come from Yahoo Finance's unofficial chart API, which falls back to its `query2` host. If a symbol fails, it fills in on the next run, because each run fetches from that symbol's latest stored date.
- ADVM, APLS, and CLSD no longer return data from Yahoo (delisted or acquired). They are still listed in holdings but have no price history.
- `/api/chart-data` is cached in the browser for an hour. It is also cached at the edge, but only once the site is on a custom domain; the Cache API does nothing on `*.workers.dev`.
