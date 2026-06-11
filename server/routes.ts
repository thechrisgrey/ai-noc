import type { Express } from "express";
import { createServer, type IncomingMessage, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { timingSafeEqualStr } from "./originVerify";
import { PRIORITY_ALERT_THRESHOLD } from "@shared/constants";
import { fetchAllFeeds, probeFeedUrl, seedDemoData } from "./feedEngine";
import { getHealthMap, getHealthSummary } from "./feedHealth";
import { generateBriefing } from "./briefing";
import { validateSourceInput, SOURCE_CATEGORIES } from "./sourceValidation";

let lastRefreshed: string | null = null;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // WebSocket server for real-time push to connected clients
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    verifyClient: (info: { req: IncomingMessage }) => {
      const token = process.env.ORIGIN_VERIFY_TOKEN;
      if (!token) return true;
      const header = info.req.headers["x-origin-verify"];
      return typeof header === "string" && timingSafeEqualStr(header, token);
    },
  });
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
          .filter((item) => (item.priority ?? 0) >= PRIORITY_ALERT_THRESHOLD)
          .map((item) => ({ id: item.id, title: item.title, sourceLabel: item.sourceLabel, priority: item.priority }));
        if (highPriority.length > 0) {
          broadcast({ type: "alert", items: highPriority });
        }
      }
    })
    .then(() => generateBriefing().catch(err => console.error("[Briefing] Initial generation failed:", err.message)))
    .catch(err => console.error("[Routes] Initial feed fetch failed:", err.message));

  // Generate briefing every hour
  setInterval(() => {
    generateBriefing().catch(err => console.error("[Briefing] Hourly generation failed:", err.message));
  }, 60 * 60 * 1000);

  // Retention pruning: delete unbookmarked items older than RETENTION_DAYS.
  // Disabled unless the env var parses to a positive integer.
  const retentionDays = parseInt(process.env.RETENTION_DAYS || "", 10);
  if (retentionDays > 0) {
    const prune = () =>
      storage
        .pruneOldItems(retentionDays)
        .then((pruned) => console.log(`[Retention] Pruned ${pruned} items older than ${retentionDays} days`))
        .catch((err) => console.error("[Retention] Prune failed:", err.message));
    setTimeout(prune, 5 * 60 * 1000);
    setInterval(prune, 24 * 60 * 60 * 1000);
  }

  // Poll feeds every 2 minutes for near-real-time coverage
  setInterval(() => {
    fetchAllFeeds()
      .then(async ({ newItemCount, newItemIds }) => {
        lastRefreshed = new Date().toISOString();
        if (newItemCount > 0) {
          broadcast({ type: "new_items", count: newItemCount, timestamp: lastRefreshed });
          const newItems = await storage.getItemsByIds(newItemIds);
          const highPriority = newItems
            .filter((item) => (item.priority ?? 0) >= PRIORITY_ALERT_THRESHOLD)
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

      // Validate & sanitize inputs
      const validCategories = ["all", "model_release", "research", "funding", "product", "policy", "infrastructure"];
      const safeLimit = Math.max(1, Math.min(parseInt(limit as string) || 30, 100));
      const safeCategory = validCategories.includes(category as string) ? (category as string) : undefined;
      const safeSort = sort === "priority" ? "priority" as const : "time" as const;
      const safeSource = typeof source === "string" && /^[a-z0-9_]+$/.test(source) ? source : undefined;
      const safeSearch = typeof search === "string" ? search.trim().slice(0, 200) || undefined : undefined;

      const result = await storage.getFeedItems({
        limit: safeLimit,
        cursor: cursor as string | undefined,
        category: safeCategory,
        source: safeSource,
        search: safeSearch,
        sort: safeSort,
      });

      // Batch bookmark check (1 query instead of N)
      const bookmarkedIds = await storage.getBookmarkedIds(
        result.items.map((i) => i.id),
      );
      const clusterIds = Array.from(
        new Set(result.items.map((i) => i.clusterId).filter((c): c is string => !!c)),
      );
      const clusterCounts = await storage.getClusterCounts(clusterIds);
      const itemsWithBookmarks = result.items.map((item) => ({
        ...item,
        isBookmarked: bookmarkedIds.has(item.id),
        coverageCount: item.clusterId ? clusterCounts.get(item.clusterId) ?? 1 : 1,
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
          .filter((item) => (item.priority ?? 0) >= PRIORITY_ALERT_THRESHOLD)
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

  // Mark specific items as read
  app.post("/api/items/read", async (req, res) => {
    try {
      const { ids } = req.body;
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 200 ||
        !ids.every((id) => Number.isInteger(id))
      ) {
        return res.status(400).json({ error: "ids must be an array of 1-200 integers" });
      }
      await storage.markRead(ids);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark items read" });
    }
  });

  // Mark everything published at or before a timestamp as read
  app.post("/api/feed/read-all", async (req, res) => {
    try {
      const { before } = req.body;
      if (typeof before !== "string" || Number.isNaN(Date.parse(before))) {
        return res.status(400).json({ error: "before must be a parseable ISO date string" });
      }
      await storage.markAllRead(before);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark all read" });
    }
  });

  // Cluster siblings for a feed item (other sources covering the same story)
  app.get("/api/items/:id/cluster", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "id must be an integer" });
      }
      const siblings = await storage.getClusterSiblings(id);
      res.json(siblings);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch cluster siblings" });
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

  // Source management
  app.get("/api/sources", async (_req, res) => {
    try {
      const [rows, stats] = await Promise.all([storage.getSources(), storage.getStats()]);
      const health = getHealthMap();
      res.json(
        rows.map((s) => ({
          ...s,
          itemCount: stats.bySource[s.slug] ?? 0,
          health: health[s.slug] ?? null,
        })),
      );
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch sources" });
    }
  });

  app.post("/api/sources", async (req, res) => {
    try {
      const existing = await storage.getSources();
      const validated = validateSourceInput(
        req.body ?? {},
        existing.map((s) => s.slug),
      );
      if (!validated.ok) {
        return res.status(400).json({ error: validated.error });
      }
      if (existing.some((s) => s.url === validated.url)) {
        return res.status(409).json({ error: "A source with this URL already exists" });
      }

      let probe: { feedTitle: string; itemCount: number };
      try {
        probe = await probeFeedUrl(validated.url);
      } catch (err) {
        return res.status(422).json({ error: (err as Error).message });
      }

      const created = await storage.createSource({
        slug: validated.slug,
        label: validated.label,
        url: validated.url,
        defaultCategory: validated.defaultCategory,
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      res.json({ ...created, feedTitle: probe.feedTitle, itemCount: probe.itemCount });
    } catch (err) {
      res.status(500).json({ error: "Failed to create source" });
    }
  });

  app.patch("/api/sources/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "id must be an integer" });
      }
      const { enabled, label, defaultCategory } = req.body ?? {};
      if (enabled !== undefined && typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      if (label !== undefined && (typeof label !== "string" || !label.trim())) {
        return res.status(400).json({ error: "label must be a non-empty string" });
      }
      if (defaultCategory !== undefined && !SOURCE_CATEGORIES.includes(defaultCategory)) {
        return res
          .status(400)
          .json({ error: `defaultCategory must be one of: ${SOURCE_CATEGORIES.join(", ")}` });
      }
      const updated = await storage.updateSource(id, {
        enabled,
        label: typeof label === "string" ? label.trim() : undefined,
        defaultCategory,
      });
      if (!updated) {
        return res.status(404).json({ error: "Source not found" });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to update source" });
    }
  });

  // Existing feed_items keep the deleted source's slug — intentional orphans.
  app.delete("/api/sources/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "id must be an integer" });
      }
      await storage.deleteSource(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete source" });
    }
  });

  // Briefing
  app.get("/api/briefing", async (_req, res) => {
    try {
      const briefing = await storage.getLatestBriefing();
      res.json(briefing || { content: null, generatedAt: null, itemCount: 0 });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch briefing" });
    }
  });

  app.post("/api/briefing/regenerate", async (_req, res) => {
    try {
      const content = await generateBriefing();
      if (content) {
        const briefing = await storage.getLatestBriefing();
        res.json(briefing);
      } else {
        res.status(503).json({ error: "Could not generate briefing" });
      }
    } catch (err) {
      res.status(500).json({ error: "Failed to regenerate briefing" });
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
