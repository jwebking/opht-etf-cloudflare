import { it, expect } from "vitest";
import { buildSeedSql, buildKvEntries } from "../scripts/seed-sql";

it("emits tickers, prices, caps and status as idempotent inserts", () => {
  const sql = buildSeedSql({ SPY: [{ date: "2025-01-02", adjClose: 1.5 }] }, { ALC: 42 }, "2026-10-05");
  expect(sql).toContain("INSERT OR REPLACE INTO tickers (symbol, company_name, category) VALUES ('ADVM', 'Adverum Biotechnologies', 'opht')");
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
