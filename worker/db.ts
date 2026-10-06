import type { PricePoint } from "./ingest";

const BATCH = 100;

export async function getLatestDate(db: D1Database, symbol: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT MAX(date) AS d FROM price_history WHERE symbol = ?1")
    .bind(symbol)
    .first<{ d: string | null }>();
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
  const { results } = await db
    .prepare("SELECT symbol, market_cap FROM market_caps")
    .all<{ symbol: string; market_cap: number | null }>();
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
