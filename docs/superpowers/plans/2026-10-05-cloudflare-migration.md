# OPHT Cloudflare Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Replit Express/Postgres backend with a Cloudflare Worker + D1 + KV + Cron, keeping the React front end and API response shapes unchanged.

**Architecture:** Vite builds the existing React app (kept in `client/`) to `dist/client`, served as Workers static assets. A Worker in `worker/` handles `/api/*` (D1 for source of truth, KV holding one pre-serialized JSON array per symbol) and a batched weekday cron that appends new Yahoo prices. A local Node script does the one-time 10-year backfill.

**Tech Stack:** TypeScript, React 18, Vite 7, Tailwind 3, Cloudflare Workers, D1, KV, Wrangler 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-cloudflare-migration-design.md` (see its "Revisions during planning" section)

## Global Constraints

- Response shapes of `/api/status`, `/api/chart-data`, `/api/holdings` must match the current Express app exactly; `client/src/pages/home.tsx` and `client/src/lib/indexCalculations.ts` are not modified.
- Must run on Workers Free: ≤50 external subrequests and minimal CPU per invocation.
- Cron: `30,35,40,45 22 * * 1-5`; 4 batches of 7 symbols.
- KV key format: `prices:<SYMBOL>`; value is a JSON array `[{"date":"YYYY-MM-DD","adjClose":n},...]` ascending by date; metadata `{ "last": "YYYY-MM-DD" }`.
- Yahoo requests send `User-Agent: Mozilla/5.0`.
- No Stooq (bot-walled); fallback is Yahoo `query2` host. Market caps come from FMP only (Yahoo chart meta has no market cap).

---

### Task 1: Strip Replit/Express and set up Worker tooling

**Files:**
- Delete: `server/`, `shared/`, `script/`, `drizzle.config.ts`, `.replit`, `replit.md`, unused `client/src/components/ui/*` (all except `card.tsx`, `toast.tsx`, `toaster.tsx`, `tooltip.tsx`)
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`, `.gitignore`
- Create: `worker/tsconfig.json`, `worker/env.ts`, `wrangler.jsonc`, `vitest.config.ts`

- [ ] **Step 1: Delete Replit/Express files and unused UI components**

```bash
git rm -rq server shared script drizzle.config.ts .replit replit.md
cd client/src/components/ui && git rm -q $(ls | grep -vE '^(card|toast|toaster|tooltip)\.tsx$') && cd -
```

- [ ] **Step 2: Rewrite `package.json`** with only what is used:

```json
{
  "name": "opht-etf",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:api": "wrangler dev",
    "build": "vite build",
    "preview": "vite build && wrangler dev",
    "deploy": "vite build && wrangler deploy",
    "test": "vitest run",
    "check": "tsc -p tsconfig.json && tsc -p worker/tsconfig.json",
    "seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@tanstack/react-query": "^5.60.5",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lightweight-charts": "^5.1.0",
    "lucide-react": "^0.453.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^2.6.0",
    "wouter": "^3.3.5"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4",
    "@tailwindcss/typography": "^0.5.15",
    "@types/node": "^22",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "tsx": "^4.20.5",
    "typescript": "^5.6.3",
    "vite": "^7.3.0",
    "vitest": "^3",
    "wrangler": "^4"
  }
}
```

Then `rm -rf node_modules package-lock.json && npm install`.

- [ ] **Step 3: Rewrite `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "client", "src") },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
```

- [ ] **Step 4: Update root `tsconfig.json`** — `include: ["client/src/**/*", "scripts/**/*"]`, drop `@shared/*` path and the `incremental`/`tsBuildInfoFile` keys; keep everything else.

- [ ] **Step 5: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 6: Create `worker/env.ts`**

```ts
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CHART_CACHE: KVNamespace;
  FMP_API_KEY?: string;
  ADMIN_TOKEN?: string;
}
```

- [ ] **Step 7: Create `wrangler.jsonc`** (IDs are placeholders until Task 7; local dev accepts them)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "opht-etf",
  "main": "worker/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "opht-db", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }
  ],
  "kv_namespaces": [{ "binding": "CHART_CACHE", "id": "00000000000000000000000000000000" }],
  "triggers": { "crons": ["30,35,40,45 22 * * 1-5"] },
  "observability": { "enabled": true }
}
```

- [ ] **Step 8: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
```

- [ ] **Step 9: `.gitignore`** add `dist`, `.wrangler`, `seed/`, `.dev.vars`.

- [ ] **Step 10: Verify the front end builds**

Run: `npm run build` → Expected: `dist/client/index.html` produced, no errors. Run `npx tsc -p tsconfig.json` → no errors.

- [ ] **Step 11: Commit** `chore: strip Replit/Express, add Cloudflare Worker tooling`

---

### Task 2: Tickers and Yahoo/FMP ingest (TDD)

**Files:**
- Create: `worker/tickers.ts`, `worker/ingest.ts`, `tests/ingest.test.ts`

**Interfaces:**
- Produces: `OPHT_TICKERS: Record<string,string>`, `BENCHMARK_TICKERS`, `ALL_SYMBOLS: string[]`; `type PricePoint = { date: string; adjClose: number }`; `parseYahooChart(json: unknown): PricePoint[]`; `parseFmpMarketCap(json: unknown): number | null`; `yahooChartPath(symbol: string, params: Record<string,string>): string`; `fetchHistory(symbol, range = "10y"): Promise<PricePoint[]>`; `fetchPricesSince(symbol, fromDate, now = Date.now()): Promise<PricePoint[]>`; `fetchMarketCap(symbol, fmpKey?): Promise<number | null>`.

- [ ] **Step 1: Create `worker/tickers.ts`** — copy the 26-entry `OPHT_TICKERS` and 2-entry `BENCHMARK_TICKERS` maps verbatim from the old `server/fmp.ts`, and export `ALL_SYMBOLS = [...Object.keys(OPHT_TICKERS), ...Object.keys(BENCHMARK_TICKERS)]`.

- [ ] **Step 2: Write failing tests `tests/ingest.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseYahooChart, parseFmpMarketCap, yahooChartPath } from "../worker/ingest";

const chart = (timestamp: number[], adj: (number | null)[], close?: (number | null)[]) => ({
  chart: { result: [{ timestamp, indicators: { adjclose: adj.length ? [{ adjclose: adj }] : undefined, quote: [{ close: close ?? [] }] } }] },
});

describe("parseYahooChart", () => {
  it("maps timestamps to UTC dates with adjusted close, ascending", () => {
    const pts = parseYahooChart(chart([1759411800, 1759325400], [11, 10]));
    expect(pts).toEqual([{ date: "2025-10-01", adjClose: 10 }, { date: "2025-10-02", adjClose: 11 }]);
  });
  it("skips null and NaN closes", () => {
    expect(parseYahooChart(chart([1759325400, 1759411800], [null, NaN as number]))).toEqual([]);
  });
  it("falls back to quote close when adjclose is missing", () => {
    expect(parseYahooChart(chart([1759325400], [], [5]))).toEqual([{ date: "2025-10-01", adjClose: 5 }]);
  });
  it("dedupes repeated dates keeping the last value", () => {
    expect(parseYahooChart(chart([1759325400, 1759340000], [1, 2]))).toEqual([{ date: "2025-10-01", adjClose: 2 }]);
  });
  it("returns [] for an error payload", () => {
    expect(parseYahooChart({ chart: { result: null, error: { code: "Not Found" } } })).toEqual([]);
  });
});

describe("parseFmpMarketCap", () => {
  it("reads marketCap from the first profile", () => expect(parseFmpMarketCap([{ marketCap: 123 }])).toBe(123));
  it("returns null for empty, zero, or malformed", () => {
    expect(parseFmpMarketCap([])).toBeNull();
    expect(parseFmpMarketCap([{ marketCap: 0 }])).toBeNull();
    expect(parseFmpMarketCap({ error: "x" })).toBeNull();
  });
});

describe("yahooChartPath", () => {
  it("builds a daily chart path", () => {
    expect(yahooChartPath("SPY", { range: "10y" })).toBe("/v8/finance/chart/SPY?range=10y&interval=1d");
  });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/ingest.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `worker/ingest.ts`**

```ts
export type PricePoint = { date: string; adjClose: number };

const UA = { "User-Agent": "Mozilla/5.0" };
const YAHOO_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const FMP_BASE = "https://financialmodelingprep.com/stable";

export function parseYahooChart(json: unknown): PricePoint[] {
  const result = (json as any)?.chart?.result?.[0];
  const timestamps: number[] | undefined = result?.timestamp;
  if (!timestamps) return [];
  const closes: (number | null)[] =
    result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map<string, number>();
  timestamps.forEach((ts, i) => {
    const c = closes[i];
    if (c != null && Number.isFinite(c)) byDate.set(new Date(ts * 1000).toISOString().slice(0, 10), c);
  });
  return [...byDate]
    .map(([date, adjClose]) => ({ date, adjClose }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function parseFmpMarketCap(json: unknown): number | null {
  const cap = Array.isArray(json) ? json[0]?.marketCap : undefined;
  return typeof cap === "number" && cap > 0 ? cap : null;
}

export function yahooChartPath(symbol: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, interval: "1d" });
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`;
}

async function fetchYahoo(path: string): Promise<PricePoint[]> {
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(host + path, { headers: UA });
      if (res.ok) return parseYahooChart(await res.json());
      console.warn(`Yahoo ${res.status} for ${host}${path}`);
    } catch (err) {
      console.warn(`Yahoo fetch error for ${host}${path}:`, err);
    }
  }
  throw new Error(`Yahoo fetch failed: ${path}`);
}

export function fetchHistory(symbol: string, range = "10y"): Promise<PricePoint[]> {
  return fetchYahoo(yahooChartPath(symbol, { range }));
}

export function fetchPricesSince(symbol: string, fromDate: string, now = Date.now()): Promise<PricePoint[]> {
  const period1 = Math.floor(Date.parse(`${fromDate}T00:00:00Z`) / 1000);
  const period2 = Math.floor(now / 1000);
  return fetchYahoo(yahooChartPath(symbol, { period1: String(period1), period2: String(period2) }));
}

export async function fetchMarketCap(symbol: string, fmpKey?: string): Promise<number | null> {
  if (!fmpKey) return null;
  try {
    const res = await fetch(`${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${fmpKey}`);
    return res.ok ? parseFmpMarketCap(await res.json()) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run** `npx vitest run tests/ingest.test.ts` → PASS. `npx tsc -p worker/tsconfig.json` → no errors.

- [ ] **Step 6: Commit** `feat(worker): tickers and Yahoo/FMP ingest with parser tests`

---

### Task 3: D1 schema and data access

**Files:**
- Create: `migrations/0001_init.sql`, `worker/db.ts`

**Interfaces:**
- Consumes: `PricePoint` (Task 2)
- Produces: `getLatestDate(db, symbol): Promise<string|null>`, `upsertPrices(db, symbol, points: PricePoint[]): Promise<void>`, `getSeries(db, symbol): Promise<PricePoint[]>`, `upsertMarketCap(db, symbol, cap: number): Promise<void>`, `getMarketCaps(db): Promise<Record<string, number>>`, `getStatus(db, key): Promise<string|null>`, `setStatus(db, key, value): Promise<void>`

- [ ] **Step 1: Create `migrations/0001_init.sql`**

```sql
CREATE TABLE tickers (
  symbol TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'opht'
);
CREATE TABLE price_history (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  adj_close REAL NOT NULL,
  PRIMARY KEY (symbol, date)
);
CREATE TABLE market_caps (
  symbol TEXT PRIMARY KEY,
  market_cap REAL,
  last_updated TEXT
);
CREATE TABLE data_status (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);
```

- [ ] **Step 2: Create `worker/db.ts`**

```ts
import type { PricePoint } from "./ingest";

const BATCH = 100;

export async function getLatestDate(db: D1Database, symbol: string): Promise<string | null> {
  const row = await db.prepare("SELECT MAX(date) AS d FROM price_history WHERE symbol = ?1").bind(symbol).first<{ d: string | null }>();
  return row?.d ?? null;
}

export async function upsertPrices(db: D1Database, symbol: string, points: PricePoint[]): Promise<void> {
  const stmt = db.prepare(
    "INSERT INTO price_history (symbol, date, adj_close) VALUES (?1, ?2, ?3) ON CONFLICT(symbol, date) DO UPDATE SET adj_close = excluded.adj_close",
  );
  for (let i = 0; i < points.length; i += BATCH) {
    await db.batch(points.slice(i, i + BATCH).map((p) => stmt.bind(symbol, p.date, p.adjClose)));
  }
}

export async function getSeries(db: D1Database, symbol: string): Promise<PricePoint[]> {
  const { results } = await db
    .prepare("SELECT date, adj_close AS adjClose FROM price_history WHERE symbol = ?1 ORDER BY date")
    .bind(symbol)
    .all<PricePoint>();
  return results;
}

export async function upsertMarketCap(db: D1Database, symbol: string, cap: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO market_caps (symbol, market_cap, last_updated) VALUES (?1, ?2, ?3) ON CONFLICT(symbol) DO UPDATE SET market_cap = excluded.market_cap, last_updated = excluded.last_updated",
    )
    .bind(symbol, cap, new Date().toISOString())
    .run();
}

export async function getMarketCaps(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db.prepare("SELECT symbol, market_cap FROM market_caps").all<{ symbol: string; market_cap: number | null }>();
  const caps: Record<string, number> = {};
  for (const r of results) if (r.market_cap) caps[r.symbol] = r.market_cap;
  return caps;
}

export async function getStatus(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM data_status WHERE key = ?1").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setStatus(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO data_status (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, value, new Date().toISOString())
    .run();
}
```

- [ ] **Step 3: Verify** `npx wrangler d1 migrations apply opht-db --local` → 1 migration applied; `npx tsc -p worker/tsconfig.json` → clean. (db.ts is exercised end-to-end in Task 6.)

- [ ] **Step 4: Commit** `feat(worker): D1 schema and data access`

---

### Task 4: Pure API builders + update helpers (TDD)

**Files:**
- Create: `worker/api.ts`, `worker/batch.ts`, `tests/api.test.ts`, `tests/batch.test.ts`

**Interfaces:**
- Produces (`api.ts`): `priceKey(symbol): string` → `"prices:" + symbol`; `buildChartDataJson(entries: Array<[string, string | null]>): string`; `type Holding = { symbol: string; companyName: string; marketCap: number }`; `buildHoldings(tickers: Record<string,string>, caps: Record<string,number>): Holding[]`
- Produces (`batch.ts`): `BATCH_COUNT = 4`; `batchForMinute(minute: number): number`; `symbolsForBatch(batch: number, symbols?: string[]): string[]`; `nextDay(date: string): string`; `appendPoints(existing: string, points: PricePoint[]): string`

- [ ] **Step 1: Write failing tests `tests/api.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildChartDataJson, buildHoldings, priceKey } from "../worker/api";

describe("buildChartDataJson", () => {
  it("concatenates raw JSON arrays keyed by symbol, omitting missing", () => {
    const json = buildChartDataJson([["SPY", '[{"date":"2025-01-02","adjClose":1}]'], ["ADVM", null], ["VTI", "[]"]]);
    expect(JSON.parse(json)).toEqual({ SPY: [{ date: "2025-01-02", adjClose: 1 }], VTI: [] });
  });
  it("returns {} when nothing is cached", () => expect(buildChartDataJson([["SPY", null]])).toBe("{}"));
});

describe("buildHoldings", () => {
  it("merges names with caps, defaults 0, sorts by cap desc", () => {
    expect(buildHoldings({ A: "Alpha", B: "Beta", C: "Gamma" }, { A: 5, C: 9 })).toEqual([
      { symbol: "C", companyName: "Gamma", marketCap: 9 },
      { symbol: "A", companyName: "Alpha", marketCap: 5 },
      { symbol: "B", companyName: "Beta", marketCap: 0 },
    ]);
  });
});

it("priceKey", () => expect(priceKey("SPY")).toBe("prices:SPY"));
```

- [ ] **Step 2: Write failing tests `tests/batch.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { batchForMinute, symbolsForBatch, nextDay, appendPoints, BATCH_COUNT } from "../worker/batch";
import { ALL_SYMBOLS } from "../worker/tickers";

describe("batchForMinute", () => {
  it("maps cron minutes 30/35/40/45 to batches 0..3", () => {
    expect([30, 35, 40, 45].map(batchForMinute)).toEqual([0, 1, 2, 3]);
  });
  it("clamps out-of-range minutes", () => {
    expect(batchForMinute(0)).toBe(0);
    expect(batchForMinute(59)).toBe(3);
  });
});

describe("symbolsForBatch", () => {
  it("splits all 28 symbols into 4 disjoint batches of 7 covering everything", () => {
    const batches = Array.from({ length: BATCH_COUNT }, (_, b) => symbolsForBatch(b));
    expect(batches.map((b) => b.length)).toEqual([7, 7, 7, 7]);
    expect(batches.flat().sort()).toEqual([...ALL_SYMBOLS].sort());
  });
});

describe("nextDay", () => {
  it("handles month/year rollover in UTC", () => {
    expect(nextDay("2025-12-31")).toBe("2026-01-01");
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
  });
});

describe("appendPoints", () => {
  const p = (date: string, adjClose: number) => ({ date, adjClose });
  it("appends to a non-empty array without reparsing", () => {
    const out = appendPoints('[{"date":"2025-01-02","adjClose":1}]', [p("2025-01-03", 2)]);
    expect(JSON.parse(out)).toEqual([p("2025-01-02", 1), p("2025-01-03", 2)]);
  });
  it("appends to an empty array", () => expect(JSON.parse(appendPoints("[]", [p("2025-01-03", 2)]))).toEqual([p("2025-01-03", 2)]));
  it("returns input unchanged when there is nothing to add", () => expect(appendPoints("[1]", [])).toBe("[1]"));
});
```

- [ ] **Step 3: Run** `npx vitest run` → FAIL (modules not found).

- [ ] **Step 4: Implement `worker/api.ts`**

```ts
export type Holding = { symbol: string; companyName: string; marketCap: number };

export const priceKey = (symbol: string) => `prices:${symbol}`;

export function buildChartDataJson(entries: Array<[string, string | null]>): string {
  const parts = entries.filter(([, v]) => v !== null).map(([s, v]) => `${JSON.stringify(s)}:${v}`);
  return `{${parts.join(",")}}`;
}

export function buildHoldings(tickers: Record<string, string>, caps: Record<string, number>): Holding[] {
  return Object.entries(tickers)
    .map(([symbol, companyName]) => ({ symbol, companyName, marketCap: caps[symbol] || 0 }))
    .sort((a, b) => b.marketCap - a.marketCap);
}
```

- [ ] **Step 5: Implement `worker/batch.ts`**

```ts
import type { PricePoint } from "./ingest";
import { ALL_SYMBOLS } from "./tickers";

export const BATCH_COUNT = 4;
const FIRST_MINUTE = 30;
const STEP_MINUTES = 5;

export function batchForMinute(minute: number): number {
  const b = Math.floor((minute - FIRST_MINUTE) / STEP_MINUTES);
  return Math.min(Math.max(b, 0), BATCH_COUNT - 1);
}

export function symbolsForBatch(batch: number, symbols: string[] = ALL_SYMBOLS): string[] {
  const size = Math.ceil(symbols.length / BATCH_COUNT);
  return symbols.slice(batch * size, (batch + 1) * size);
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Append points to a serialized JSON array via string ops (no parse — keeps Worker CPU tiny). */
export function appendPoints(existing: string, points: PricePoint[]): string {
  if (points.length === 0) return existing;
  const tail = points.map((p) => JSON.stringify({ date: p.date, adjClose: p.adjClose })).join(",");
  const trimmed = existing.trimEnd();
  if (trimmed === "[]") return `[${tail}]`;
  return `${trimmed.slice(0, -1)},${tail}]`;
}
```

- [ ] **Step 6: Run** `npx vitest run` → all PASS.

- [ ] **Step 7: Commit** `feat(worker): chart-data/holdings builders and batch helpers`

---

### Task 5: Worker entry, routes, and cron update

**Files:**
- Create: `worker/update.ts`, `worker/routes.ts`, `worker/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4, `Env` from Task 1.
- Produces: `runUpdate(env: Env, symbols: string[], markComplete: boolean): Promise<{status:"success"; results: SymbolResult[]}>`; `handleApi(request, env, ctx): Promise<Response>`; default export `{ fetch, scheduled }`.

- [ ] **Step 1: Implement `worker/update.ts`**

```ts
import type { Env } from "./env";
import { fetchMarketCap, fetchPricesSince } from "./ingest";
import { getLatestDate, getSeries, setStatus, upsertMarketCap, upsertPrices } from "./db";
import { OPHT_TICKERS } from "./tickers";
import { priceKey } from "./api";
import { appendPoints, batchForMinute, BATCH_COUNT, nextDay, symbolsForBatch } from "./batch";

export type SymbolResult = { symbol: string; added: number; error?: string };

async function updateSymbol(env: Env, symbol: string): Promise<SymbolResult> {
  const latest = await getLatestDate(env.DB, symbol);
  if (!latest) return { symbol, added: 0, error: "not seeded" };

  const fresh = (await fetchPricesSince(symbol, nextDay(latest))).filter((p) => p.date > latest);
  if (fresh.length) await upsertPrices(env.DB, symbol, fresh);

  if (symbol in OPHT_TICKERS) {
    const cap = await fetchMarketCap(symbol, env.FMP_API_KEY);
    if (cap !== null) await upsertMarketCap(env.DB, symbol, cap);
  }

  // KV is written only after D1 succeeded. Append when KV is in sync with D1, else rebuild from D1.
  const key = priceKey(symbol);
  const { value, metadata } = await env.CHART_CACHE.getWithMetadata<{ last?: string }>(key, "text");
  const last = fresh.length ? fresh[fresh.length - 1].date : latest;
  const inSync = value !== null && metadata?.last === latest;
  if (inSync && fresh.length === 0) return { symbol, added: 0 };
  const next = inSync ? appendPoints(value, fresh) : JSON.stringify(await getSeries(env.DB, symbol));
  await env.CHART_CACHE.put(key, next, { metadata: { last } });
  return { symbol, added: fresh.length };
}

export async function runUpdate(env: Env, symbols: string[], markComplete: boolean) {
  const results: SymbolResult[] = [];
  for (const symbol of symbols) {
    try {
      results.push(await updateSymbol(env, symbol));
    } catch (err) {
      console.error(`Update failed for ${symbol}:`, err);
      results.push({ symbol, added: 0, error: String(err) });
    }
  }
  if (markComplete) await setStatus(env.DB, "last_update", new Date().toISOString().slice(0, 10));
  console.log("Update results:", JSON.stringify(results));
  return { status: "success" as const, results };
}

export function runScheduled(scheduledTime: number, env: Env) {
  const batch = batchForMinute(new Date(scheduledTime).getUTCMinutes());
  return runUpdate(env, symbolsForBatch(batch), batch === BATCH_COUNT - 1);
}
```

- [ ] **Step 2: Implement `worker/routes.ts`**

```ts
import type { Env } from "./env";
import { ALL_SYMBOLS, OPHT_TICKERS } from "./tickers";
import { buildChartDataJson, buildHoldings, priceKey } from "./api";
import { getMarketCaps, getStatus } from "./db";
import { BATCH_COUNT, symbolsForBatch } from "./batch";
import { runUpdate } from "./update";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (message: string, status: number) => json({ status: "error", message }, status);

async function chartData(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default; // no-op on *.workers.dev, active on a custom domain
  const cacheKey = new Request(new URL("/api/chart-data", request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const keys = ALL_SYMBOLS.map(priceKey);
  const values = await env.CHART_CACHE.get(keys, "text");
  const body = buildChartDataJson(ALL_SYMBOLS.map((s) => [s, values.get(priceKey(s)) ?? null]));
  const res = new Response(body, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function adminUpdate(request: Request, env: Env, params: URLSearchParams): Promise<Response> {
  if (!env.ADMIN_TOKEN) return error("Not found", 404);
  if (request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return error("Unauthorized", 401);
  const batch = Number(params.get("batch"));
  if (!Number.isInteger(batch) || batch < 0 || batch >= BATCH_COUNT) {
    return error(`batch must be 0..${BATCH_COUNT - 1}`, 400);
  }
  return json(await runUpdate(env, symbolsForBatch(batch), batch === BATCH_COUNT - 1));
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);
  try {
    if (request.method === "GET" && pathname === "/api/status") {
      return json({
        seeded: (await getStatus(env.DB, "initial_seed")) === "complete",
        lastUpdate: await getStatus(env.DB, "last_update"),
        seedInProgress: false,
      });
    }
    if (request.method === "GET" && pathname === "/api/chart-data") return chartData(request, env, ctx);
    if (request.method === "GET" && pathname === "/api/holdings") {
      return json(buildHoldings(OPHT_TICKERS, await getMarketCaps(env.DB)));
    }
    if (request.method === "POST" && pathname === "/api/admin/update") return adminUpdate(request, env, searchParams);
    return error("Not found", 404);
  } catch (err) {
    console.error(`API error on ${pathname}:`, err);
    return error("Internal Server Error", 500);
  }
}
```

- [ ] **Step 3: Implement `worker/index.ts`**

```ts
import type { Env } from "./env";
import { handleApi } from "./routes";
import { runScheduled } from "./update";

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.scheduledTime, env));
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Verify** `npx tsc -p worker/tsconfig.json` clean; `npx vitest run` PASS; `npx wrangler deploy --dry-run --outdir .wrangler/dry` bundles without error.

- [ ] **Step 5: Commit** `feat(worker): API routes, cron update, entry point`

---

### Task 6: Seed script + local end-to-end verification

**Files:**
- Create: `scripts/seed-sql.ts`, `scripts/seed.ts`, `tests/seed-sql.test.ts`

**Interfaces:**
- Consumes: `fetchHistory`, `fetchMarketCap`, `PricePoint`, tickers, `priceKey`.
- Produces: `buildSeedSql(series: Record<string, PricePoint[]>, caps: Record<string, number>, today: string): string`; `buildKvEntries(series): Array<{key: string; value: string; metadata: {last: string}}>`

- [ ] **Step 1: Write failing test `tests/seed-sql.test.ts`**

```ts
import { it, expect } from "vitest";
import { buildSeedSql, buildKvEntries } from "../scripts/seed-sql";

it("emits tickers, prices, caps and status as idempotent inserts", () => {
  const sql = buildSeedSql({ SPY: [{ date: "2025-01-02", adjClose: 1.5 }] }, { ALC: 42 }, "2026-10-05");
  expect(sql).toContain("INSERT OR REPLACE INTO tickers (symbol, company_name, category) VALUES ('ALC', 'Alcon Inc.', 'opht')");
  expect(sql).toContain("('SPY', 'SPDR S&P 500 ETF Trust', 'benchmark')");
  expect(sql).toContain("INSERT OR REPLACE INTO price_history (symbol, date, adj_close) VALUES ('SPY', '2025-01-02', 1.5);");
  expect(sql).toContain("INSERT OR REPLACE INTO market_caps (symbol, market_cap, last_updated) VALUES ('ALC', 42, '2026-10-05');");
  expect(sql).toContain("('initial_seed', 'complete', '2026-10-05')");
  expect(sql).toContain("('last_update', '2026-10-05', '2026-10-05')");
});

it("builds KV entries with last-date metadata, skipping empty series", () => {
  const entries = buildKvEntries({ SPY: [{ date: "2025-01-02", adjClose: 1 }], ADVM: [] });
  expect(entries).toEqual([{ key: "prices:SPY", value: '[{"date":"2025-01-02","adjClose":1}]', metadata: { last: "2025-01-02" } }]);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `scripts/seed-sql.ts`**

```ts
import type { PricePoint } from "../worker/ingest";
import { BENCHMARK_TICKERS, OPHT_TICKERS } from "../worker/tickers";
import { priceKey } from "../worker/api";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ROWS_PER_INSERT = 500;

export function buildSeedSql(series: Record<string, PricePoint[]>, caps: Record<string, number>, today: string): string {
  const out: string[] = [];
  const tickers = [
    ...Object.entries(OPHT_TICKERS).map(([s, n]) => `(${q(s)}, ${q(n)}, 'opht')`),
    ...Object.entries(BENCHMARK_TICKERS).map(([s, n]) => `(${q(s)}, ${q(n)}, 'benchmark')`),
  ];
  out.push(`INSERT OR REPLACE INTO tickers (symbol, company_name, category) VALUES ${tickers.join(", ")};`);
  for (const [symbol, points] of Object.entries(series)) {
    for (let i = 0; i < points.length; i += ROWS_PER_INSERT) {
      const rows = points.slice(i, i + ROWS_PER_INSERT).map((p) => `(${q(symbol)}, ${q(p.date)}, ${p.adjClose})`);
      out.push(`INSERT OR REPLACE INTO price_history (symbol, date, adj_close) VALUES ${rows.join(", ")};`);
    }
  }
  for (const [symbol, cap] of Object.entries(caps)) {
    out.push(`INSERT OR REPLACE INTO market_caps (symbol, market_cap, last_updated) VALUES (${q(symbol)}, ${cap}, ${q(today)});`);
  }
  out.push(
    `INSERT OR REPLACE INTO data_status (key, value, updated_at) VALUES ('initial_seed', 'complete', ${q(today)}), ('last_update', ${q(today)}, ${q(today)});`,
  );
  return out.join("\n") + "\n";
}

export function buildKvEntries(series: Record<string, PricePoint[]>) {
  return Object.entries(series)
    .filter(([, points]) => points.length > 0)
    .map(([symbol, points]) => ({
      key: priceKey(symbol),
      value: JSON.stringify(points.map((p) => ({ date: p.date, adjClose: p.adjClose }))),
      metadata: { last: points[points.length - 1].date },
    }));
}
```

- [ ] **Step 4: Run** `npx vitest run` → PASS.

- [ ] **Step 5: Implement `scripts/seed.ts`**

```ts
// One-time 10-year backfill. Usage: npm run seed -- --local | --remote
// Optional: FMP_API_KEY=... for market caps.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ALL_SYMBOLS, OPHT_TICKERS } from "../worker/tickers";
import { fetchHistory, fetchMarketCap, type PricePoint } from "../worker/ingest";
import { buildKvEntries, buildSeedSql } from "./seed-sql";

const mode = process.argv.includes("--remote") ? "--remote" : process.argv.includes("--local") ? "--local" : null;
if (!mode) throw new Error("Pass --local or --remote");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const series: Record<string, PricePoint[]> = {};
for (const symbol of ALL_SYMBOLS) {
  try {
    series[symbol] = await fetchHistory(symbol, "10y");
    console.log(`${symbol}: ${series[symbol].length} rows`);
  } catch (err) {
    console.warn(`${symbol}: FAILED (${err}) — skipped`);
  }
  await sleep(500);
}

const caps: Record<string, number> = {};
if (process.env.FMP_API_KEY) {
  for (const symbol of Object.keys(OPHT_TICKERS)) {
    const cap = await fetchMarketCap(symbol, process.env.FMP_API_KEY);
    if (cap !== null) caps[symbol] = cap;
    await sleep(300);
  }
} else {
  console.warn("FMP_API_KEY not set — market caps not seeded (market-cap weighting needs them).");
}

mkdirSync("seed", { recursive: true });
writeFileSync("seed/seed.sql", buildSeedSql(series, caps, new Date().toISOString().slice(0, 10)));
writeFileSync("seed/kv.json", JSON.stringify(buildKvEntries(series)));

const wrangler = (...args: string[]) => execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
wrangler("d1", "migrations", "apply", "opht-db", mode);
wrangler("d1", "execute", "opht-db", mode, "--file", "seed/seed.sql", "--yes");
wrangler("kv", "bulk", "put", "seed/kv.json", "--binding", "CHART_CACHE", mode);
console.log("Seed complete.");
```

- [ ] **Step 6: Seed locally and run end to end**

Run: `npm run seed -- --local` → 25 symbols with rows, 3 skipped (ADVM, APLS, CLSD), wrangler applies SQL and KV.
Run: `npm run preview` (wrangler dev on :8787). Then:
- `curl -s localhost:8787/api/status` → `{"seeded":true,"lastUpdate":"<today>","seedInProgress":false}`
- `curl -s localhost:8787/api/chart-data | head -c 200` → `{"ALC":[{"date":...`
- `curl -s localhost:8787/api/holdings | head -c 200` → array of 26 holdings
- `curl -s -X POST "localhost:8787/__scheduled?cron=30+22+*+*+1-5"` (wrangler dev `--test-scheduled`) → logs show batch 0 results with `added` ≥ 0 and no errors.

- [ ] **Step 7: Browser check** — open `http://localhost:8787`: chart renders OPHT/SPY/VTI lines, all 3 weighting modes switch, holdings table populates, theme toggle works, 375px mobile width has no horizontal scroll, no console errors.

- [ ] **Step 8: Commit** `feat: local seed script and end-to-end verification`

---

### Task 7: Docs, provisioning, deploy

**Files:**
- Create: `README.md`; Modify: `wrangler.jsonc` (real IDs), spec Revisions section

- [ ] **Step 1: Write `README.md`** — what the app is, local dev (`npm install`, `npx wrangler d1 migrations apply opht-db --local`, `npm run seed -- --local`, `npm run preview`; `npm run dev` + `npm run dev:api` for HMR), deploy setup (the 4 one-time steps from the spec), secrets, cron schedule, how to trigger a manual update (`curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/api/admin/update?batch=0`), and the free-tier limits rationale.

- [ ] **Step 2: Commit and push** `docs: README for Cloudflare setup` → `git push`.

- [ ] **Step 3 (requires user's `npx wrangler login`):** `npx wrangler d1 create opht-db` and `npx wrangler kv namespace create CHART_CACHE`; paste IDs into `wrangler.jsonc`; commit/push.

- [ ] **Step 4:** `npm run seed -- --remote`.

- [ ] **Step 5 (user, dashboard):** Workers & Pages → Create → Import a repository → `jwebking/opht-etf-cloudflare`; build command `npm run build`; deploy command `npx wrangler deploy`. Optionally add secrets `FMP_API_KEY`, `ADMIN_TOKEN`.

- [ ] **Step 6: Verify production** — open the `*.workers.dev` URL; hit the 3 API routes; run `POST /api/admin/update?batch=0..3` once each and confirm `error` is absent for live symbols (proves Yahoo reachable from Cloudflare); check Workers Logs.
