import { storage } from "./storage";

const FMP_BASE = "https://financialmodelingprep.com/stable";
const API_KEY = process.env.FMP_API_KEY;

const OPHT_TICKERS: Record<string, string> = {
  ADVM: "Adverum Biotechnologies",
  ALC: "Alcon Inc.",
  APLS: "Apellis Pharmaceuticals",
  BLCO: "Bausch + Lomb Corporation",
  CLSD: "Clearside Biomedical",
  COO: "The Cooper Companies",
  CZMWY: "Carl Zeiss Meditec (ADR)",
  EYPT: "EyePoint Pharmaceuticals",
  GKOS: "Glaukos Corporation",
  HOCPY: "Hoya Corporation (ADR)",
  HROW: "Harrow Inc.",
  IRIX: "IRIDEX Corporation",
  KALA: "Kala Bio",
  KOD: "Kodiak Sciences",
  LENZ: "LENZ Therapeutics",
  LNSR: "LENSAR Inc.",
  OCGN: "Ocugen Inc.",
  OCS: "Oculis Holding",
  OCUL: "Ocular Therapeutix",
  OKYO: "OKYO Pharma",
  RXST: "RxSight Inc.",
  SGHT: "Sight Sciences",
  SGP: "SpyGlass Pharma",
  STAA: "STAAR Surgical Company",
  TARS: "Tarsus Pharmaceuticals",
  VRDN: "Viridian Therapeutics",
};

const BENCHMARK_TICKERS: Record<string, string> = {
  SPY: "SPDR S&P 500 ETF Trust",
  VTI: "Vanguard Total Stock Market ETF",
};

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchYahooHistorical(symbol: string, range: string = "10y"): Promise<Array<{ date: string; adjClose: number }>> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) {
      console.error(`Yahoo API error for ${symbol}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp) return [];

    const timestamps: number[] = result.timestamp;
    const adjCloses: number[] = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];

    const prices: Array<{ date: string; adjClose: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (adjCloses[i] != null && !isNaN(adjCloses[i])) {
        const d = new Date(timestamps[i] * 1000);
        const dateStr = d.toISOString().split("T")[0];
        prices.push({ date: dateStr, adjClose: adjCloses[i] });
      }
    }
    return prices;
  } catch (err) {
    console.error(`Yahoo fetch error for ${symbol}:`, err);
    return [];
  }
}

async function fetchYahooHistoricalFrom(symbol: string, fromDate: string): Promise<Array<{ date: string; adjClose: number }>> {
  try {
    const fromTs = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTs = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${fromTs}&period2=${toTs}&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp) return [];

    const timestamps: number[] = result.timestamp;
    const adjCloses: number[] = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];

    const prices: Array<{ date: string; adjClose: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (adjCloses[i] != null && !isNaN(adjCloses[i])) {
        const d = new Date(timestamps[i] * 1000);
        const dateStr = d.toISOString().split("T")[0];
        prices.push({ date: dateStr, adjClose: adjCloses[i] });
      }
    }
    return prices;
  } catch (err) {
    console.error(`Yahoo fetch error for ${symbol}:`, err);
    return [];
  }
}

async function fetchMarketCapFMP(symbol: string): Promise<number | null> {
  if (!API_KEY) return null;
  try {
    const url = `${FMP_BASE}/profile?symbol=${symbol}&apikey=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0].marketCap || null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchMarketCapYahoo(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta?.marketCap) return meta.marketCap;
    return null;
  } catch {
    return null;
  }
}

async function fetchMarketCap(symbol: string): Promise<number | null> {
  const fmpCap = await fetchMarketCapFMP(symbol);
  if (fmpCap) return fmpCap;
  return fetchMarketCapYahoo(symbol);
}

export async function seedTickers(): Promise<void> {
  for (const [symbol, name] of Object.entries(OPHT_TICKERS)) {
    await storage.upsertTicker({ symbol, companyName: name, category: "opht" });
  }
  for (const [symbol, name] of Object.entries(BENCHMARK_TICKERS)) {
    await storage.upsertTicker({ symbol, companyName: name, category: "benchmark" });
  }
}

export async function seedAllData(): Promise<{ status: string; message: string }> {
  const seedStatus = await storage.getDataStatus("initial_seed");
  if (seedStatus === "complete") {
    return { status: "already_seeded", message: "Data already seeded" };
  }

  const inProgress = await storage.getDataStatus("seed_in_progress");
  if (inProgress === "true") {
    return { status: "in_progress", message: "Seeding already in progress" };
  }

  await storage.setDataStatus("seed_in_progress", "true");

  try {
    await seedTickers();

    const allSymbols = [...Object.keys(OPHT_TICKERS), ...Object.keys(BENCHMARK_TICKERS)];

    for (const symbol of allSymbols) {
      console.log(`Fetching historical data for ${symbol}...`);
      const prices = await fetchYahooHistorical(symbol, "10y");
      console.log(`  Got ${prices.length} data points for ${symbol}`);
      if (prices.length > 0) {
        await storage.upsertPriceHistory(
          prices.map(p => ({ symbol, date: p.date, adjClose: p.adjClose }))
        );
      }
      await delay(500);
    }

    for (const symbol of Object.keys(OPHT_TICKERS)) {
      console.log(`Fetching market cap for ${symbol}...`);
      const cap = await fetchMarketCap(symbol);
      if (cap !== null) {
        console.log(`  ${symbol} market cap: ${cap}`);
        await storage.upsertMarketCap(symbol, cap);
      }
      await delay(300);
    }

    await storage.setDataStatus("initial_seed", "complete");
    await storage.setDataStatus("last_update", new Date().toISOString().split("T")[0]);
    await storage.setDataStatus("seed_in_progress", "false");

    return { status: "success", message: "Data seeded successfully" };
  } catch (error: any) {
    await storage.setDataStatus("seed_in_progress", "false");
    console.error("Seed error:", error);
    return { status: "error", message: error.message };
  }
}

export async function dailyUpdate(): Promise<{ status: string; message: string }> {
  const today = new Date().toISOString().split("T")[0];
  const lastUpdate = await storage.getDataStatus("last_update");

  if (lastUpdate === today) {
    return { status: "up_to_date", message: "Already updated today" };
  }

  const allSymbols = [...Object.keys(OPHT_TICKERS), ...Object.keys(BENCHMARK_TICKERS)];

  for (const symbol of allSymbols) {
    const latestDate = await storage.getLatestPriceDate(symbol);
    if (latestDate) {
      const nextDay = new Date(latestDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const fromDate = nextDay.toISOString().split("T")[0];
      const prices = await fetchYahooHistoricalFrom(symbol, fromDate);
      if (prices.length > 0) {
        await storage.upsertPriceHistory(
          prices.map(p => ({ symbol, date: p.date, adjClose: p.adjClose }))
        );
      }
    }
    await delay(300);
  }

  for (const symbol of Object.keys(OPHT_TICKERS)) {
    const cap = await fetchMarketCap(symbol);
    if (cap !== null) {
      await storage.upsertMarketCap(symbol, cap);
    }
    await delay(300);
  }

  await storage.setDataStatus("last_update", today);
  return { status: "success", message: "Daily update complete" };
}

export function getOphtTickers() {
  return OPHT_TICKERS;
}

export function getBenchmarkTickers() {
  return BENCHMARK_TICKERS;
}
