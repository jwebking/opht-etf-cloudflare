export type Holding = { symbol: string; companyName: string; marketCap: number };

export const priceKey = (symbol: string) => `prices:${symbol}`;

export function buildChartDataJson(entries: Array<[string, string | null]>): string {
  const parts = entries.filter(([, v]) => v !== null).map(([s, v]) => `${JSON.stringify(s)}:${v}`);
  return `{${parts.join(",")}}`;
}

export function buildHoldings(tickers: Record<string, string>, caps: Record<string, number>): Holding[] {
  return Object.entries(tickers)
    .map(([symbol, companyName]) => ({ symbol, companyName, marketCap: caps[symbol] || 0 }))
    .sort((a, b) => b.marketCap - a.marketCap);
}
