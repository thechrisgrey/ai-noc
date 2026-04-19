import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage } from "../../server/storage";

describe("DatabaseStorage (PGlite)", () => {
  let storage: DatabaseStorage;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;
    close = () => s.close();
  });

  afterAll(async () => {
    await close();
  });

  it("inserts and retrieves a feed item", async () => {
    const created = await storage.createFeedItem({
      title: "Test item",
      description: "desc",
      url: "https://x.test/1",
      source: "openai",
      sourceLabel: "OpenAI",
      category: "model_release",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      guid: "guid-1",
      isBreaking: false,
      imageUrl: null,
    });

    expect(created.id).toBeGreaterThan(0);

    const fetched = await storage.getFeedItemById(created.id);
    expect(fetched?.title).toBe("Test item");

    expect(await storage.feedItemExists("guid-1")).toBe(true);
    expect(await storage.feedItemExists("nope")).toBe(false);
  });

  it("filters by category and source on getFeedItems", async () => {
    await storage.createFeedItem({
      title: "Anthropic x", description: null, url: null,
      source: "anthropic", sourceLabel: "Anthropic", category: "research",
      publishedAt: new Date(Date.now() - 1000).toISOString(),
      fetchedAt: new Date().toISOString(), guid: "guid-2", isBreaking: false, imageUrl: null,
    });
    await storage.createFeedItem({
      title: "Meta product", description: null, url: null,
      source: "meta_ai", sourceLabel: "Meta", category: "product",
      publishedAt: new Date(Date.now() - 2000).toISOString(),
      fetchedAt: new Date().toISOString(), guid: "guid-3", isBreaking: false, imageUrl: null,
    });

    const research = await storage.getFeedItems({ category: "research" });
    expect(research.items.every((i) => i.category === "research")).toBe(true);
    expect(research.items.length).toBeGreaterThan(0);

    const meta = await storage.getFeedItems({ source: "meta_ai" });
    expect(meta.items.every((i) => i.source === "meta_ai")).toBe(true);
  });

  it("paginates via cursor", async () => {
    const first = await storage.getFeedItems({ limit: 2 });
    expect(first.items.length).toBeLessThanOrEqual(2);
    if (first.nextCursor) {
      const second = await storage.getFeedItems({ limit: 2, cursor: first.nextCursor });
      for (const a of first.items) {
        for (const b of second.items) {
          expect(a.id).not.toBe(b.id);
        }
      }
    }
  });

  it("search is LIKE-escaped (% and _ treated literally)", async () => {
    await storage.createFeedItem({
      title: "Benchmark % score improved", description: null, url: null,
      source: "openai", sourceLabel: "OpenAI", category: "model_release",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(), guid: "guid-pct", isBreaking: false, imageUrl: null,
    });
    const res = await storage.getFeedItems({ search: "%" });
    expect(res.items.some((i) => i.guid === "guid-pct")).toBe(true);
  });

  it("bookmark create / isBookmarked / delete round-trip", async () => {
    const item = await storage.createFeedItem({
      title: "Bookmark me", description: null, url: null,
      source: "openai", sourceLabel: "OpenAI", category: "product",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(), guid: "guid-bm", isBreaking: false, imageUrl: null,
    });

    await storage.createBookmark({
      feedItemId: item.id,
      createdAt: new Date().toISOString(),
    });
    expect(await storage.isBookmarked(item.id)).toBe(true);

    await storage.deleteBookmark(item.id);
    expect(await storage.isBookmarked(item.id)).toBe(false);
  });

  it("bulkUpdatePriorities updates multiple rows in one round trip", async () => {
    const a = await storage.createFeedItem({
      title: "bulk a", description: null, url: null,
      source: "openai", sourceLabel: "OpenAI", category: "product",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(), guid: "bulk-a", isBreaking: false, imageUrl: null,
    });
    const b = await storage.createFeedItem({
      title: "bulk b", description: null, url: null,
      source: "anthropic", sourceLabel: "Anthropic", category: "product",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(), guid: "bulk-b", isBreaking: false, imageUrl: null,
    });

    await storage.bulkUpdatePriorities([
      { id: a.id, priority: 42, isBreaking: false },
      { id: b.id, priority: 88, isBreaking: true },
    ]);

    const aAfter = await storage.getFeedItemById(a.id);
    const bAfter = await storage.getFeedItemById(b.id);
    expect(aAfter?.priority).toBe(42);
    expect(aAfter?.isBreaking).toBe(false);
    expect(bAfter?.priority).toBe(88);
    expect(bAfter?.isBreaking).toBe(true);
  });

  it("bulkUpdateClusterIds assigns cluster membership", async () => {
    const a = await storage.createFeedItem({
      title: "cluster a", description: null, url: null,
      source: "openai", sourceLabel: "OpenAI", category: "product",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(), guid: "clu-a", isBreaking: false, imageUrl: null,
    });
    const b = await storage.createFeedItem({
      title: "cluster b", description: null, url: null,
      source: "anthropic", sourceLabel: "Anthropic", category: "product",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(), guid: "clu-b", isBreaking: false, imageUrl: null,
    });
    await storage.bulkUpdateClusterIds([
      { id: a.id, clusterId: "story-1" },
      { id: b.id, clusterId: "story-1" },
    ]);
    const aAfter = await storage.getFeedItemById(a.id);
    const bAfter = await storage.getFeedItemById(b.id);
    expect(aAfter?.clusterId).toBe("story-1");
    expect(bAfter?.clusterId).toBe("story-1");
  });
});
