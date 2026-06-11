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

describe("decayStalePriorities", () => {
  let storage: DatabaseStorage;
  let staleId: number;
  let freshId: number;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
    const stale = await storage.createFeedItem({
      title: "stale breaking", description: null, url: null,
      source: "openai", sourceLabel: "OpenAI", category: "model_release",
      publishedAt: hoursAgo(80),
      fetchedAt: new Date().toISOString(), guid: "decay-stale", isBreaking: false, imageUrl: null,
    });
    const fresh = await storage.createFeedItem({
      title: "fresh breaking", description: null, url: null,
      source: "anthropic", sourceLabel: "Anthropic", category: "model_release",
      publishedAt: hoursAgo(10),
      fetchedAt: new Date().toISOString(), guid: "decay-fresh", isBreaking: false, imageUrl: null,
    });
    staleId = stale.id;
    freshId = fresh.id;
    await storage.bulkUpdatePriorities([
      { id: staleId, priority: 85, isBreaking: true },
      { id: freshId, priority: 85, isBreaking: true },
    ]);
  });

  afterAll(async () => {
    await storage.close();
  });

  it("caps stale items at 50, clears breaking, and leaves fresh items untouched", async () => {
    const affected = await storage.decayStalePriorities(72);
    expect(affected).toBe(1);

    const stale = await storage.getFeedItemById(staleId);
    expect(stale?.priority).toBe(50);
    expect(stale?.isBreaking).toBe(false);

    const fresh = await storage.getFeedItemById(freshId);
    expect(fresh?.priority).toBe(85);
    expect(fresh?.isBreaking).toBe(true);

    const stats = await storage.getStats();
    expect(stats.breakingCount).toBe(1);
  });

  it("second run affects 0 rows", async () => {
    expect(await storage.decayStalePriorities(72)).toBe(0);
  });
});

describe("read state", () => {
  let storage: DatabaseStorage;
  let ids: number[];

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
    ids = [];
    for (const [guid, hours] of [["read-a", 1], ["read-b", 2], ["read-c", 3]] as const) {
      const item = await storage.createFeedItem({
        title: guid, description: null, url: null,
        source: "openai", sourceLabel: "OpenAI", category: "product",
        publishedAt: hoursAgo(hours),
        fetchedAt: new Date().toISOString(), guid, isBreaking: false, imageUrl: null,
      });
      ids.push(item.id);
    }
  });

  afterAll(async () => {
    await storage.close();
  });

  it("counts everything unread initially", async () => {
    const stats = await storage.getStats();
    expect(stats.unreadCount).toBe(3);
  });

  it("markRead sets readAt for the given ids only", async () => {
    await storage.markRead([ids[0]]);

    const read = await storage.getFeedItemById(ids[0]);
    expect(read?.readAt).toBeTruthy();

    const untouched = await storage.getFeedItemById(ids[1]);
    expect(untouched?.readAt).toBeNull();

    const stats = await storage.getStats();
    expect(stats.unreadCount).toBe(2);
  });

  it("markAllRead only affects unread items published at or before the cutoff", async () => {
    const twoAndAHalfHoursAgo = new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString();
    await storage.markAllRead(twoAndAHalfHoursAgo);

    // read-c (3h old) is within the cutoff; read-b (2h old) is newer than it.
    expect((await storage.getFeedItemById(ids[2]))?.readAt).toBeTruthy();
    expect((await storage.getFeedItemById(ids[1]))?.readAt).toBeNull();

    const stats = await storage.getStats();
    expect(stats.unreadCount).toBe(1);
  });
});

describe("pruneOldItems", () => {
  let storage: DatabaseStorage;
  let oldId: number;
  let oldBookmarkedId: number;
  let freshId: number;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    const make = async (guid: string, days: number) =>
      (
        await storage.createFeedItem({
          title: guid, description: null, url: null,
          source: "openai", sourceLabel: "OpenAI", category: "product",
          publishedAt: daysAgo(days),
          fetchedAt: new Date().toISOString(), guid, isBreaking: false, imageUrl: null,
        })
      ).id;

    oldId = await make("prune-old", 120);
    oldBookmarkedId = await make("prune-old-bookmarked", 120);
    freshId = await make("prune-fresh", 5);

    await storage.createBookmark({
      feedItemId: oldBookmarkedId,
      createdAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await storage.close();
  });

  it("deletes old unbookmarked items but spares bookmarked and fresh ones", async () => {
    const pruned = await storage.pruneOldItems(90);
    expect(pruned).toBe(1);

    expect(await storage.getFeedItemById(oldId)).toBeUndefined();
    expect(await storage.getFeedItemById(oldBookmarkedId)).toBeDefined();
    expect(await storage.getFeedItemById(freshId)).toBeDefined();
  });

  it("is idempotent: second run deletes nothing", async () => {
    expect(await storage.pruneOldItems(90)).toBe(0);
  });
});

describe("cluster expansion", () => {
  let storage: DatabaseStorage;
  let first: number;
  let second: number;
  let third: number;
  let loner: number;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
    const make = async (guid: string, hours: number) =>
      (
        await storage.createFeedItem({
          title: guid, description: null, url: null,
          source: "openai", sourceLabel: "OpenAI", category: "product",
          publishedAt: hoursAgo(hours),
          fetchedAt: new Date().toISOString(), guid, isBreaking: false, imageUrl: null,
        })
      ).id;

    first = await make("clu-first", 8);
    second = await make("clu-second", 4);
    third = await make("clu-third", 1);
    loner = await make("clu-loner", 2);

    await storage.bulkUpdateClusterIds([
      { id: first, clusterId: "story-x" },
      { id: second, clusterId: "story-x" },
      { id: third, clusterId: "story-x" },
    ]);
  });

  afterAll(async () => {
    await storage.close();
  });

  it("getClusterCounts returns member counts per cluster id", async () => {
    const counts = await storage.getClusterCounts(["story-x", "story-missing"]);
    expect(counts.get("story-x")).toBe(3);
    expect(counts.has("story-missing")).toBe(false);
    expect((await storage.getClusterCounts([])).size).toBe(0);
  });

  it("getClusterSiblings excludes self and orders by publishedAt ascending", async () => {
    const siblings = await storage.getClusterSiblings(third);
    expect(siblings.map((i) => i.id)).toEqual([first, second]);
  });

  it("getClusterSiblings returns empty for unclustered or missing items", async () => {
    expect(await storage.getClusterSiblings(loner)).toEqual([]);
    expect(await storage.getClusterSiblings(999999)).toEqual([]);
  });
});

describe("getBriefings kind filter + limit", () => {
  let storage: DatabaseStorage;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString();
    // Interleave hourly and digest briefings with distinct generatedAt.
    await storage.createBriefing({ content: "hourly-1", itemCount: 5, generatedAt: minutesAgo(50), kind: "hourly" });
    await storage.createBriefing({ content: "digest-1", itemCount: 12, generatedAt: minutesAgo(40), kind: "daily_digest" });
    await storage.createBriefing({ content: "hourly-2", itemCount: 6, generatedAt: minutesAgo(30), kind: "hourly" });
    await storage.createBriefing({ content: "hourly-3", itemCount: 7, generatedAt: minutesAgo(20), kind: "hourly" });
    await storage.createBriefing({ content: "digest-2", itemCount: 11, generatedAt: minutesAgo(10), kind: "daily_digest" });
  });

  afterAll(async () => {
    await storage.close();
  });

  it("returns all kinds newest-first when no kind filter is given", async () => {
    const rows = await storage.getBriefings({});
    expect(rows.map((b) => b.content)).toEqual([
      "digest-2",
      "hourly-3",
      "hourly-2",
      "digest-1",
      "hourly-1",
    ]);
  });

  it("filters to a single kind", async () => {
    const digests = await storage.getBriefings({ kind: "daily_digest" });
    expect(digests.map((b) => b.content)).toEqual(["digest-2", "digest-1"]);
    expect(digests.every((b) => b.kind === "daily_digest")).toBe(true);
  });

  it("clamps the result to the requested limit", async () => {
    const rows = await storage.getBriefings({ limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toBe("digest-2");
  });

  it("getLatestBriefing(kind) returns the newest of that kind", async () => {
    expect((await storage.getLatestBriefing("hourly"))?.content).toBe("hourly-3");
    expect((await storage.getLatestBriefing("daily_digest"))?.content).toBe("digest-2");
  });
});

describe("updateWatchlist patch", () => {
  let storage: DatabaseStorage;
  let id: number;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;
    const wl = await storage.createWatchlist({
      name: "GPU launches",
      category: "infrastructure",
      source: null,
      search: "gpu",
      sort: null,
      createdAt: new Date().toISOString(),
    });
    id = wl.id;
  });

  afterAll(async () => {
    await storage.close();
  });

  it("defaults alert false and lastTriggeredAt null on create", async () => {
    const [wl] = await storage.getWatchlists();
    expect(wl.alert).toBe(false);
    expect(wl.lastTriggeredAt).toBeNull();
  });

  it("toggles alert and stamps lastTriggeredAt independently", async () => {
    const updated = await storage.updateWatchlist(id, { alert: true });
    expect(updated?.alert).toBe(true);

    const stamp = new Date().toISOString();
    const stamped = await storage.updateWatchlist(id, { lastTriggeredAt: stamp });
    expect(stamped?.lastTriggeredAt).toBe(stamp);
    // Alert remained true — patch only touches supplied fields.
    expect(stamped?.alert).toBe(true);
  });

  it("renames without disturbing other fields", async () => {
    const renamed = await storage.updateWatchlist(id, { name: "GPU drops" });
    expect(renamed?.name).toBe("GPU drops");
    expect(renamed?.category).toBe("infrastructure");
  });

  it("an empty patch returns the unchanged row", async () => {
    const before = await storage.updateWatchlist(id, {});
    expect(before?.name).toBe("GPU drops");
  });

  it("returns undefined for a missing id", async () => {
    expect(await storage.updateWatchlist(999999, { alert: true })).toBeUndefined();
  });
});

describe("getFeedItems sinceHours", () => {
  let storage: DatabaseStorage;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
    for (const [guid, hours] of [["since-6h", 6], ["since-30h", 30], ["since-80h", 80]] as const) {
      await storage.createFeedItem({
        title: guid, description: null, url: null,
        source: "openai", sourceLabel: "OpenAI", category: "product",
        publishedAt: hoursAgo(hours),
        fetchedAt: new Date().toISOString(), guid, isBreaking: false, imageUrl: null,
      });
    }
  });

  afterAll(async () => {
    await storage.close();
  });

  it("returns only items within the window", async () => {
    const res = await storage.getFeedItems({ sinceHours: 24 });
    expect(res.items.map((i) => i.guid)).toEqual(["since-6h"]);
  });

  it("widening the window includes older items", async () => {
    const res = await storage.getFeedItems({ sinceHours: 72 });
    expect(res.items.map((i) => i.guid)).toEqual(["since-6h", "since-30h"]);
  });
});
