import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, date, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tickers = pgTable("tickers", {
  symbol: varchar("symbol", { length: 10 }).primaryKey(),
  companyName: text("company_name").notNull(),
  category: varchar("category", { length: 20 }).notNull().default("opht"),
});

export const priceHistory = pgTable("price_history", {
  symbol: varchar("symbol", { length: 10 }).notNull(),
  date: date("date").notNull(),
  adjClose: real("adj_close").notNull(),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.date] }),
]);

export const marketCaps = pgTable("market_caps", {
  symbol: varchar("symbol", { length: 10 }).primaryKey(),
  marketCap: real("market_cap"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const dataStatus = pgTable("data_status", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTickerSchema = createInsertSchema(tickers);
export const insertPriceHistorySchema = createInsertSchema(priceHistory);
export const insertMarketCapSchema = createInsertSchema(marketCaps);

export type Ticker = typeof tickers.$inferSelect;
export type InsertTicker = z.infer<typeof insertTickerSchema>;
export type PriceHistory = typeof priceHistory.$inferSelect;
export type InsertPriceHistory = z.infer<typeof insertPriceHistorySchema>;
export type MarketCap = typeof marketCaps.$inferSelect;
export type InsertMarketCap = z.infer<typeof insertMarketCapSchema>;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
