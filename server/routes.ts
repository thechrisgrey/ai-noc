import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { fetchAllFeeds, seedDemoData } from "./feedEngine";

let lastRefreshed: string | null = null;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // WebSocket server for real-time push to connected clients
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  function broadcast(data: any) {
    const msg = JSON.stringify(data);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  // Seed demo data on startup (non-blocking — DB may not be ready yet)
  try {
    await seedDemoData();
  } catch (err) {
    console.error("[Routes] Seed failed (DB may not be ready):", (err as Error).message);
  }

  // Try fetching real feeds in background (don't block startup)
  fetchAllFeeds()
    .then((newCount) => {
      lastRefreshed = new Date().toISOString();
      if (newCount > 0) broadcast({ type: "new_items", count: newCount, timestamp: lastRefreshed });
    })
    .catch(err => console.error("[Routes] Initial feed fetch failed:", err.message));

  // Poll feeds every 2 minutes for near-real-time coverage
  setInterval(() => {
    fetchAllFeeds()
      .then((newCount) => {
        lastRefreshed = new Date().toISOString();
        if (newCount > 0) broadcast({ type: "new_items", count: newCount, timestamp: lastRefreshed });
      })
      .catch(err => console.error("[Routes] Periodic feed fetch failed:", err.message));
  }, 2 * 60 * 1000);

  // Health check for ALB
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      lastRefreshed,
      timestamp: new Date().toISOString(),
    });
  });

  // Get feed items with optional filters + cursor pagination
  app.get("/api/feed", async (req, res) => {
    try {
      const { limit, cursor, category, source, search, sort } = req.query;
      const result = await storage.getFeedItems({
        limit: limit ? parseInt(limit as string) : 30,
        cursor: cursor as string | undefined,
        category: category as string | undefined,
        source: source as string | undefined,
        search: search as string | undefined,
        sort: (sort as "time" | "priority") || "time",
      });

      // Check bookmark status for each item
      const itemsWithBookmarks = await Promise.all(
        result.items.map(async (item) => ({
          ...item,
          isBookmarked: await storage.isBookmarked(item.id),
        }))
      );

      res.json({ items: itemsWithBookmarks, nextCursor: result.nextCursor });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch feed items" });
    }
  });

  // Get stats/metrics
  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getStats();
      res.json({ ...stats, lastRefreshed });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Trigger manual feed refresh
  app.post("/api/feed/refresh", async (_req, res) => {
    try {
      const newCount = await fetchAllFeeds();
      lastRefreshed = new Date().toISOString();
      if (newCount > 0) broadcast({ type: "new_items", count: newCount, timestamp: lastRefreshed });
      res.json({ newItems: newCount, lastRefreshed });
    } catch (err) {
      res.status(500).json({ error: "Failed to refresh feeds" });
    }
  });

  // Bookmark operations
  app.get("/api/bookmarks", async (_req, res) => {
    try {
      const bms = await storage.getBookmarks();
      res.json(bms);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
  });

  app.post("/api/bookmarks", async (req, res) => {
    try {
      const { feedItemId } = req.body;
      if (!feedItemId) {
        return res.status(400).json({ error: "feedItemId required" });
      }
      const isAlready = await storage.isBookmarked(feedItemId);
      if (isAlready) {
        return res.status(409).json({ error: "Already bookmarked" });
      }
      const bm = await storage.createBookmark({
        feedItemId,
        createdAt: new Date().toISOString(),
      });
      res.json(bm);
    } catch (err) {
      res.status(500).json({ error: "Failed to create bookmark" });
    }
  });

  app.delete("/api/bookmarks/:feedItemId", async (req, res) => {
    try {
      const feedItemId = parseInt(req.params.feedItemId);
      await storage.deleteBookmark(feedItemId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete bookmark" });
    }
  });

  return httpServer;
}
