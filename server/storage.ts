import { eq, and, gte, desc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  tickers, priceHistory, marketCaps, dataStatus,
  type Ticker, type InsertTicker,
  type PriceHistory, type InsertPriceHistory,
  type MarketCap, type InsertMarketCap,
} from "@shared/schema";

export interface IStorage {
  getAllTickers(): Promise<Ticker[]>;
  getTickersByCategory(category: string): Promise<Ticker[]>;
  upsertTicker(ticker: InsertTicker): Promise<void>;
  getPriceHistory(symbol: string, fromDate?: string): Promise<PriceHistory[]>;
  getAllPriceHistory(fromDate?: string): Promise<PriceHistory[]>;
  upsertPriceHistory(entries: InsertPriceHistory[]): Promise<void>;
  getLatestPriceDate(symbol: string): Promise<string | null>;
  getMarketCap(symbol: string): Promise<MarketCap | undefined>;
  getAllMarketCaps(): Promise<MarketCap[]>;
  upsertMarketCap(symbol: string, cap: number): Promise<void>;
  getDataStatus(key: string): Promise<string | null>;
  setDataStatus(key: string, value: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getAllTickers(): Promise<Ticker[]> {
    return db.select().from(tickers);
  }

  async getTickersByCategory(category: string): Promise<Ticker[]> {
    return db.select().from(tickers).where(eq(tickers.category, category));
  }

  async upsertTicker(ticker: InsertTicker): Promise<void> {
    await db.insert(tickers)
      .values(ticker)
      .onConflictDoUpdate({
        target: tickers.symbol,
        set: { companyName: ticker.companyName, category: ticker.category },
      });
  }

  async getPriceHistory(symbol: string, fromDate?: string): Promise<PriceHistory[]> {
    if (fromDate) {
      return db.select().from(priceHistory)
        .where(and(eq(priceHistory.symbol, symbol), gte(priceHistory.date, fromDate)))
        .orderBy(priceHistory.date);
    }
    return db.select().from(priceHistory)
      .where(eq(priceHistory.symbol, symbol))
      .orderBy(priceHistory.date);
  }

  async getAllPriceHistory(fromDate?: string): Promise<PriceHistory[]> {
    if (fromDate) {
      return db.select().from(priceHistory)
        .where(gte(priceHistory.date, fromDate))
        .orderBy(priceHistory.date);
    }
    return db.select().from(priceHistory).orderBy(priceHistory.date);
  }

  async upsertPriceHistory(entries: InsertPriceHistory[]): Promise<void> {
    if (entries.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await db.insert(priceHistory)
        .values(batch)
        .onConflictDoUpdate({
          target: [priceHistory.symbol, priceHistory.date],
          set: { adjClose: sql`excluded.adj_close` },
        });
    }
  }

  async getLatestPriceDate(symbol: string): Promise<string | null> {
    const result = await db.select({ date: priceHistory.date })
      .from(priceHistory)
      .where(eq(priceHistory.symbol, symbol))
      .orderBy(desc(priceHistory.date))
      .limit(1);
    return result.length > 0 ? result[0].date : null;
  }

  async getMarketCap(symbol: string): Promise<MarketCap | undefined> {
    const result = await db.select().from(marketCaps)
      .where(eq(marketCaps.symbol, symbol));
    return result[0];
  }

  async getAllMarketCaps(): Promise<MarketCap[]> {
    return db.select().from(marketCaps);
  }

  async upsertMarketCap(symbol: string, cap: number): Promise<void> {
    await db.insert(marketCaps)
      .values({ symbol, marketCap: cap, lastUpdated: new Date() })
      .onConflictDoUpdate({
        target: marketCaps.symbol,
        set: { marketCap: cap, lastUpdated: new Date() },
      });
  }

  async getDataStatus(key: string): Promise<string | null> {
    const result = await db.select().from(dataStatus)
      .where(eq(dataStatus.key, key));
    return result.length > 0 ? result[0].value : null;
  }

  async setDataStatus(key: string, value: string): Promise<void> {
    await db.insert(dataStatus)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: dataStatus.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

export const storage = new DatabaseStorage();
