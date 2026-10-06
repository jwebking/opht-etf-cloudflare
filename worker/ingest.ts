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
