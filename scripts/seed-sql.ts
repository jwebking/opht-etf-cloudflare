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
