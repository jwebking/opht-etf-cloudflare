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
    expect(parseYahooChart(chart([1759325400, 1759411800], [null, NaN]))).toEqual([]);
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
