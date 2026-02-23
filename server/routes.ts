import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { seedAllData, dailyUpdate, getOphtTickers, getBenchmarkTickers } from "./fmp";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/seed", async (_req, res) => {
    try {
      const result = await seedAllData();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/api/update", async (_req, res) => {
    try {
      const result = await dailyUpdate();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/api/status", async (_req, res) => {
    try {
      const seedStatus = await storage.getDataStatus("initial_seed");
      const lastUpdate = await storage.getDataStatus("last_update");
      const inProgress = await storage.getDataStatus("seed_in_progress");
      res.json({
        seeded: seedStatus === "complete",
        lastUpdate,
        seedInProgress: inProgress === "true",
      });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/api/chart-data", async (_req, res) => {
    try {
      const allPrices = await storage.getAllPriceHistory();

      const grouped: Record<string, Array<{ date: string; adjClose: number }>> = {};
      for (const row of allPrices) {
        if (!grouped[row.symbol]) grouped[row.symbol] = [];
        grouped[row.symbol].push({ date: row.date, adjClose: row.adjClose });
      }

      res.json(grouped);
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/api/holdings", async (_req, res) => {
    try {
      const ophtTickers = getOphtTickers();
      const allCaps = await storage.getAllMarketCaps();
      const capMap: Record<string, number> = {};
      for (const mc of allCaps) {
        if (mc.marketCap) capMap[mc.symbol] = mc.marketCap;
      }

      const holdings = Object.entries(ophtTickers).map(([symbol, companyName]) => ({
        symbol,
        companyName,
        marketCap: capMap[symbol] || 0,
      }));

      holdings.sort((a, b) => b.marketCap - a.marketCap);

      res.json(holdings);
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // Auto-seed on startup
  seedAllData().then(result => {
    console.log("Auto-seed result:", result);
    if (result.status === "already_seeded") {
      dailyUpdate().then(updateResult => {
        console.log("Daily update result:", updateResult);
      });
    }
  });

  return httpServer;
}
