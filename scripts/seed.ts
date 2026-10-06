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
