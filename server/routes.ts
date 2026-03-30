import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { fetchAllFeeds, seedDemoData } from "./feedEngine";
import { getHealthMap, getHealthSummary } from "./feedHealth";

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
    .then(async ({ newItemCount, newItemIds }) => {
      lastRefreshed = new Date().toISOString();
      if (newItemCount > 0) {
        broadcast({ type: "new_items", count: newItemCount, timestamp: lastRefreshed });
        const newItems = await storage.getItemsByIds(newItemIds);
        const highPriority = newItems
          .filter((item) => (item.priority ?? 0) >= 80)
          .map((item) => ({ id: item.id, title: item.title, sourceLabel: item.sourceLabel, priority: item.priority }));
        if (highPriority.length > 0) {
          broadcast({ type: "alert", items: highPriority });
        }
      }
    })
    .catch(err => console.error("[Routes] Initial feed fetch failed:", err.message));

  // Poll feeds every 2 minutes for near-real-time coverage
  setInterval(() => {
    fetchAllFeeds()
      .then(async ({ newItemCount, newItemIds }) => {
        lastRefreshed = new Date().toISOString();
        if (newItemCount > 0) {
          broadcast({ type: "new_items", count: newItemCount, timestamp: lastRefreshed });
          const newItems = await storage.getItemsByIds(newItemIds);
          const highPriority = newItems
            .filter((item) => (item.priority ?? 0) >= 80)
            .map((item) => ({ id: item.id, title: item.title, sourceLabel: item.sourceLabel, priority: item.priority }));
          if (highPriority.length > 0) {
            broadcast({ type: "alert", items: highPriority });
          }
        }
      })
      .catch(err => console.error("[Routes] Periodic feed fetch failed:", err.message));
  }, 2 * 60 * 1000);

  // Health check for ALB (includes DB connectivity)
  app.get("/api/health", async (_req, res) => {
    try {
      await storage.getStats(); // lightweight DB ping
      res.json({
        status: "ok",
        db: "ok",
        uptime: process.uptime(),
        lastRefreshed,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: "degraded",
        db: "unreachable",
        uptime: process.uptime(),
        lastRefreshed,
        timestamp: new Date().toISOString(),
      });
    }
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

      // Batch bookmark check (1 query instead of N)
      const bookmarkedIds = await storage.getBookmarkedIds(
        result.items.map((i) => i.id),
      );
      const itemsWithBookmarks = result.items.map((item) => ({
        ...item,
        isBookmarked: bookmarkedIds.has(item.id),
      }));

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
      const { newItemCount, newItemIds } = await fetchAllFeeds();
      lastRefreshed = new Date().toISOString();
      if (newItemCount > 0) {
        broadcast({ type: "new_items", count: newItemCount, timestamp: lastRefreshed });
        const newItems = await storage.getItemsByIds(newItemIds);
        const highPriority = newItems
          .filter((item) => (item.priority ?? 0) >= 80)
          .map((item) => ({ id: item.id, title: item.title, sourceLabel: item.sourceLabel, priority: item.priority }));
        if (highPriority.length > 0) {
          broadcast({ type: "alert", items: highPriority });
        }
      }
      res.json({ newItems: newItemCount, lastRefreshed });
    } catch (err) {
      res.status(500).json({ error: "Failed to refresh feeds" });
    }
  });

  // Source activity (sparkline data over last 7 days)
  app.get("/api/sources/activity", async (_req, res) => {
    try {
      const activity = await storage.getSourceActivity(7);
      res.json(activity);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch source activity" });
    }
  });

  // Source health
  app.get("/api/sources/health", async (_req, res) => {
    try {
      const health = getHealthMap();
      const summary = getHealthSummary();
      res.json({ health, summary });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch source health" });
    }
  });

  // Watchlist operations
  app.get("/api/watchlists", async (_req, res) => {
    try {
      const wl = await storage.getWatchlists();
      res.json(wl);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch watchlists" });
    }
  });

  app.post("/api/watchlists", async (req, res) => {
    try {
      const { name, category, source, search, sort } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      const wl = await storage.createWatchlist({
        name: name.trim(),
        category: category || null,
        source: source || null,
        search: search || null,
        sort: sort || null,
        createdAt: new Date().toISOString(),
      });
      res.json(wl);
    } catch (err) {
      res.status(500).json({ error: "Failed to create watchlist" });
    }
  });

  app.delete("/api/watchlists/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteWatchlist(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete watchlist" });
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
