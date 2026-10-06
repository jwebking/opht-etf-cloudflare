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
