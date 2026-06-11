import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage } from "../../server/storage";
import type { FeedItem } from "@shared/schema";

/**
 * Contract test for /api/feed. We build a minimal express app that replicates
 * the route's validation + handler logic, wired to an isolated PGlite storage.
 * This keeps the response envelope, filter enum handling, and limit clamping
 * under test without spinning up the full server (which would require the
 * WebSocket + interval setup).
 */
function buildApp(storage: DatabaseStorage) {
  const app = express();
  app.use(express.json());

  app.get("/api/feed", async (req, res) => {
    const { limit, cursor, category, source, search, sort } = req.query;

    const validCategories = ["all", "model_release", "research", "funding", "product", "policy", "infrastructure"];
    const safeLimit = Math.max(1, Math.min(parseInt(limit as string) || 30, 100));
    const safeCategory = validCategories.includes(category as string) ? (category as string) : undefined;
    const safeSort = sort === "priority" ? ("priority" as const) : ("time" as const);
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

    const bookmarkedIds = await storage.getBookmarkedIds(result.items.map((i) => i.id));
    const itemsWithBookmarks = result.items.map((item) => ({
      ...item,
      isBookmarked: bookmarkedIds.has(item.id),
    }));

    res.json({ items: itemsWithBookmarks, nextCursor: result.nextCursor });
  });

  return app;
}

describe("GET /api/feed", () => {
  let storage: DatabaseStorage;
  let app: express.Express;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;
    app = buildApp(storage);

    // seed
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await storage.createFeedItem({
        title: `Item ${i}`,
        description: `Description ${i}`,
        url: `https://x.test/${i}`,
        source: i % 2 === 0 ? "openai" : "anthropic",
        sourceLabel: i % 2 === 0 ? "OpenAI" : "Anthropic",
        category: i < 3 ? "model_release" : "product",
        publishedAt: new Date(now - i * 1000).toISOString(),
        fetchedAt: new Date(now).toISOString(),
        guid: `feed-${i}`,
        isBreaking: i === 0,
        imageUrl: null,
      });
    }
  });

  afterAll(async () => {
    await storage.close();
  });

  it("returns { items, nextCursor } envelope", async () => {
    const res = await request(app).get("/api/feed");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("nextCursor");
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("each item carries isBookmarked", async () => {
    const res = await request(app).get("/api/feed");
    for (const item of res.body.items) {
      expect(item).toHaveProperty("isBookmarked");
      expect(typeof item.isBookmarked).toBe("boolean");
    }
  });

  it("rejects injection-shaped source values", async () => {
    const res = await request(app).get("/api/feed?source=';DROP TABLE feed_items;--");
    expect(res.status).toBe(200);
    // with invalid source, filter is dropped — still returns items
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("filters by valid category", async () => {
    const res = await request(app).get("/api/feed?category=model_release");
    expect(res.status).toBe(200);
    expect(res.body.items.every((i: any) => i.category === "model_release")).toBe(true);
  });

  it("clamps excessive limit values to <=100", async () => {
    const res = await request(app).get("/api/feed?limit=9999");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(100);
  });

  it("unknown category falls back to all", async () => {
    const res = await request(app).get("/api/feed?category=bogus_enum");
    expect(res.status).toBe(200);
    // should NOT filter to bogus — should return unfiltered set
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});

describe("priority pagination (composite keyset cursor)", () => {
  let storage: DatabaseStorage;
  const seededIds: number[] = [];

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const base = Date.parse("2026-06-01T00:00:00.000Z");
    const hoursAfter = (n: number) => new Date(base + n * 60 * 60 * 1000).toISOString();
    const sharedTs = hoursAfter(10);

    // Adversarial shapes: ties on priority, ties on (priority, publishedAt)
    // broken only by id, high priority on an old date, low priority on the
    // newest date.
    const shapes = [
      { priority: 70, publishedAt: hoursAfter(1) },
      { priority: 70, publishedAt: hoursAfter(2) },
      { priority: 70, publishedAt: hoursAfter(3) },
      { priority: 95, publishedAt: hoursAfter(-96) },
      { priority: 10, publishedAt: hoursAfter(48) },
      { priority: 50, publishedAt: sharedTs },
      { priority: 50, publishedAt: sharedTs },
      { priority: 50, publishedAt: sharedTs },
      { priority: 0, publishedAt: hoursAfter(20) },
      { priority: 100, publishedAt: hoursAfter(5) },
      { priority: 85, publishedAt: hoursAfter(5) },
      { priority: 85, publishedAt: hoursAfter(6) },
    ];

    const priorityRows: { id: number; priority: number; isBreaking: boolean }[] = [];
    for (let i = 0; i < shapes.length; i++) {
      const created = await storage.createFeedItem({
        title: `Priority item ${i}`,
        description: null,
        url: null,
        source: "openai",
        sourceLabel: "OpenAI",
        category: "product",
        publishedAt: shapes[i].publishedAt,
        fetchedAt: new Date().toISOString(),
        guid: `prio-${i}`,
        isBreaking: false,
        imageUrl: null,
      });
      seededIds.push(created.id);
      priorityRows.push({ id: created.id, priority: shapes[i].priority, isBreaking: false });
    }
    await storage.bulkUpdatePriorities(priorityRows);
  });

  afterAll(async () => {
    await storage.close();
  });

  it("pages through every item exactly once in (priority, publishedAt, id) order", async () => {
    const collected: FeedItem[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await storage.getFeedItems({ sort: "priority", limit: 5, cursor });
      collected.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);

    const ids = collected.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual([...seededIds].sort((a, b) => a - b));

    for (let i = 1; i < collected.length; i++) {
      const prev = collected[i - 1];
      const curr = collected[i];
      const nonIncreasing =
        (prev.priority ?? 0) > (curr.priority ?? 0) ||
        ((prev.priority ?? 0) === (curr.priority ?? 0) &&
          (prev.publishedAt > curr.publishedAt ||
            (prev.publishedAt === curr.publishedAt && prev.id > curr.id)));
      expect(nonIncreasing).toBe(true);
    }
  });

  it("ignores a malformed cursor instead of failing", async () => {
    const page = await storage.getFeedItems({
      sort: "priority",
      limit: 5,
      cursor: "garbage-cursor",
    });
    expect(page.items.length).toBe(5);
  });
});

describe("time pagination (composite keyset cursor)", () => {
  let storage: DatabaseStorage;
  const seededIds: number[] = [];

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const base = Date.parse("2026-06-01T00:00:00.000Z");
    const hoursAfter = (n: number) => new Date(base + n * 60 * 60 * 1000).toISOString();
    const sharedTs = hoursAfter(10);

    // Adversarial shapes: runs of identical publishedAt longer than the page
    // size so a page boundary must cut between same-timestamp rows.
    const timestamps = [
      hoursAfter(1),
      sharedTs,
      sharedTs,
      sharedTs,
      sharedTs,
      sharedTs,
      sharedTs,
      hoursAfter(20),
      hoursAfter(20),
      hoursAfter(48),
    ];

    for (let i = 0; i < timestamps.length; i++) {
      const created = await storage.createFeedItem({
        title: `Time item ${i}`,
        description: null,
        url: null,
        source: "openai",
        sourceLabel: "OpenAI",
        category: "product",
        publishedAt: timestamps[i],
        fetchedAt: new Date().toISOString(),
        guid: `time-${i}`,
        isBreaking: false,
        imageUrl: null,
      });
      seededIds.push(created.id);
    }
  });

  afterAll(async () => {
    await storage.close();
  });

  it("pages through every item exactly once in (publishedAt, id) order", async () => {
    const collected: FeedItem[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await storage.getFeedItems({ limit: 3, cursor });
      collected.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);

    const ids = collected.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual([...seededIds].sort((a, b) => a - b));

    for (let i = 1; i < collected.length; i++) {
      const prev = collected[i - 1];
      const curr = collected[i];
      const nonIncreasing =
        prev.publishedAt > curr.publishedAt ||
        (prev.publishedAt === curr.publishedAt && prev.id > curr.id);
      expect(nonIncreasing).toBe(true);
    }
  });

  it("ignores a malformed cursor instead of failing", async () => {
    const page = await storage.getFeedItems({
      limit: 3,
      cursor: "2026-06-01T10:00:00.000Z",
    });
    expect(page.items.length).toBe(3);
  });
});
