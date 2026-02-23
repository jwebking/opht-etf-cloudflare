export type WeightingMode = "market_cap" | "equal_weight" | "capped_25";
export type TimeRange = "1D" | "7D" | "1M" | "6M" | "1Y" | "5Y" | "10Y";

export interface Holding {
  symbol: string;
  companyName: string;
  marketCap: number;
}

export interface PricePoint {
  date: string;
  adjClose: number;
}

export function getTimeRangeStartDate(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case "1D":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    case "7D":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    case "1M":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "6M":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "1Y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "5Y":
      return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    case "10Y":
      return new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
  }
}

export function filterByTimeRange(prices: PricePoint[], range: TimeRange): PricePoint[] {
  const startDate = getTimeRangeStartDate(range);
  const startStr = startDate.toISOString().split("T")[0];
  return prices.filter(p => p.date >= startStr);
}

export function calculateWeights(
  holdings: Holding[],
  mode: WeightingMode
): Array<{ symbol: string; companyName: string; marketCap: number; weight: number }> {
  const validHoldings = holdings.filter(h => h.marketCap > 0);

  if (validHoldings.length === 0) return [];

  switch (mode) {
    case "equal_weight": {
      const w = 1 / validHoldings.length;
      return validHoldings.map(h => ({ ...h, weight: w }));
    }
    case "capped_25": {
      const totalMcap = validHoldings.reduce((s, h) => s + h.marketCap, 0);
      let weights = validHoldings.map(h => ({
        ...h,
        weight: h.marketCap / totalMcap,
      }));

      let iterations = 0;
      while (iterations < 10) {
        const capped = weights.filter(w => w.weight > 0.25);
        if (capped.length === 0) break;

        const excess = capped.reduce((s, w) => s + (w.weight - 0.25), 0);
        const uncapped = weights.filter(w => w.weight <= 0.25);
        const uncappedTotal = uncapped.reduce((s, w) => s + w.weight, 0);

        if (uncappedTotal === 0) {
          weights = weights.map(w => ({ ...w, weight: 1 / weights.length }));
          break;
        }

        weights = weights.map(w => {
          if (w.weight > 0.25) {
            return { ...w, weight: 0.25 };
          }
          return {
            ...w,
            weight: w.weight + (w.weight / uncappedTotal) * excess,
          };
        });
        iterations++;
      }
      return weights;
    }
    case "market_cap":
    default: {
      const totalMcap = validHoldings.reduce((s, h) => s + h.marketCap, 0);
      return validHoldings.map(h => ({
        ...h,
        weight: h.marketCap / totalMcap,
      }));
    }
  }
}

export function calculateIndexLine(
  allPrices: Record<string, PricePoint[]>,
  holdings: Holding[],
  mode: WeightingMode,
  range: TimeRange
): Array<{ time: string; value: number }> {
  const weights = calculateWeights(holdings, mode);
  if (weights.length === 0) return [];

  const weightMap: Record<string, number> = {};
  for (const w of weights) {
    weightMap[w.symbol] = w.weight;
  }

  const filteredPrices: Record<string, PricePoint[]> = {};
  for (const w of weights) {
    const prices = allPrices[w.symbol];
    if (prices) {
      filteredPrices[w.symbol] = filterByTimeRange(prices, range);
    }
  }

  const allDates = new Set<string>();
  for (const prices of Object.values(filteredPrices)) {
    for (const p of prices) {
      allDates.add(p.date);
    }
  }

  const sortedDates = Array.from(allDates).sort();
  if (sortedDates.length === 0) return [];

  const baseValues: Record<string, number> = {};
  for (const [symbol, prices] of Object.entries(filteredPrices)) {
    if (prices.length > 0) {
      baseValues[symbol] = prices[0].adjClose;
    }
  }

  const priceByDateSymbol: Record<string, Record<string, number>> = {};
  for (const [symbol, prices] of Object.entries(filteredPrices)) {
    for (const p of prices) {
      if (!priceByDateSymbol[p.date]) priceByDateSymbol[p.date] = {};
      priceByDateSymbol[p.date][symbol] = p.adjClose;
    }
  }

  const result: Array<{ time: string; value: number }> = [];
  const lastKnown: Record<string, number> = {};

  for (const date of sortedDates) {
    let indexValue = 0;
    let totalWeight = 0;

    for (const [symbol, weight] of Object.entries(weightMap)) {
      const base = baseValues[symbol];
      if (!base) continue;

      const currentPrice = priceByDateSymbol[date]?.[symbol] ?? lastKnown[symbol];
      if (currentPrice === undefined) continue;

      lastKnown[symbol] = currentPrice;
      const returnRatio = currentPrice / base;
      indexValue += weight * returnRatio;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      result.push({
        time: date,
        value: (indexValue / totalWeight) * 100,
      });
    }
  }

  return result;
}

export function calculateBenchmarkLine(
  allPrices: Record<string, PricePoint[]>,
  symbol: string,
  range: TimeRange
): Array<{ time: string; value: number }> {
  const prices = allPrices[symbol];
  if (!prices) return [];

  const filtered = filterByTimeRange(prices, range);
  if (filtered.length === 0) return [];

  const base = filtered[0].adjClose;
  return filtered.map(p => ({
    time: p.date,
    value: (p.adjClose / base) * 100,
  }));
}

export function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toLocaleString()}`;
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
