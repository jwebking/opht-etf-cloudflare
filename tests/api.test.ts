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
