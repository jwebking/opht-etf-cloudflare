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
