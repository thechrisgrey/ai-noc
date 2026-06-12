import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage } from "../../server/storage";
import type { FeedItem, InsertFeedItem } from "@shared/schema";

/** Deterministic 1024-d unit vector pointing along a single axis. */
function unitVector(axis: number): number[] {
  const v = new Array(1024).fill(0);
  v[axis] = 1;
  return v;
}

let guidCounter = 0;
function makeItem(overrides: Partial<InsertFeedItem> = {}): InsertFeedItem {
  const ts = new Date().toISOString();
  return {
    title: "item",
    description: "",
    url: "https://example.test/a",
    source: "openai",
    sourceLabel: "OpenAI",
    category: "product",
    publishedAt: ts,
    fetchedAt: ts,
    guid: `section-test-${guidCounter++}`,
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 0,
    readAt: null,
    embedding: null,
    ...overrides,
  };
}

describe("sourceSlugs filtering", () => {
  let storage: DatabaseStorage;
  let awsItem: FeedItem;
  let openaiItem: FeedItem;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;
    awsItem = await storage.createFeedItem(makeItem({ source: "aws_ml", sourceLabel: "AWS ML Blog" }));
    await storage.createFeedItem(makeItem({ source: "ionq", sourceLabel: "IonQ" }));
    openaiItem = await storage.createFeedItem(makeItem({ source: "openai", sourceLabel: "OpenAI", isBreaking: true }));
  });

  afterAll(async () => {
    await storage.close();
  });

  it("filters getFeedItems to the given slugs", async () => {
    const { items } = await storage.getFeedItems({ sourceSlugs: ["aws_ml"] });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("aws_ml");
  });

  it("returns an empty page for an empty slug list", async () => {
    const result = await storage.getFeedItems({ sourceSlugs: [] });
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("composes sourceSlugs with the category filter", async () => {
    const { items } = await storage.getFeedItems({
      sourceSlugs: ["aws_ml", "ionq"],
      category: "product",
    });
    expect(items.map((i) => i.source).sort()).toEqual(["aws_ml", "ionq"]);
  });

  it("scopes getStats to the given slugs", async () => {
    const stats = await storage.getStats({ sourceSlugs: ["openai"] });
    expect(stats.total).toBe(1);
    expect(stats.breakingCount).toBe(1);
    expect(stats.bySource).toEqual({ openai: 1 });
    expect(stats.byCategory).toEqual({ product: 1 });
  });

  it("returns zeroed stats for an empty slug list", async () => {
    const stats = await storage.getStats({ sourceSlugs: [] });
    expect(stats).toEqual({
      total: 0,
      byCategory: {},
      bySource: {},
      breakingCount: 0,
      unreadCount: 0,
    });
  });

  it("scopes getSourceActivity to the given slugs", async () => {
    const activity = await storage.getSourceActivity(7, ["ionq"]);
    expect(Object.keys(activity)).toEqual(["ionq"]);
    expect(await storage.getSourceActivity(7, [])).toEqual({});
  });

  it("scopes searchSemantic to the given slugs", async () => {
    // Real embeddings on two sources so the non-empty IN-list fragment
    // actually executes against pgvector (not just the short-circuit).
    const vec = unitVector(0);
    await storage.updateEmbeddings([
      { id: awsItem.id, embedding: vec },
      { id: openaiItem.id, embedding: vec },
    ]);

    const results = await storage.searchSemantic(vec, { sourceSlugs: ["aws_ml"] });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("aws_ml");

    expect(await storage.searchSemantic(vec, { sourceSlugs: [] })).toEqual([]);
  });

  it("scopes getSourceIntel to the given slugs", async () => {
    // No clustered items seeded, so both calls return empty — this asserts
    // the parameter is accepted and the empty-list short-circuit works.
    expect(await storage.getSourceIntel(7, ["ionq"])).toEqual([]);
    expect(await storage.getSourceIntel(7, [])).toEqual([]);
  });
});
