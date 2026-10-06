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
