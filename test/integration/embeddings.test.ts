import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage } from "../../server/storage";
import type { InsertFeedItem } from "@shared/schema";

/** Deterministic 1024-d unit vector pointing along a single axis. */
function unitVector(axis: number): number[] {
  const v = new Array(1024).fill(0);
  v[axis] = 1;
  return v;
}

function makeItem(guid: string, overrides: Partial<InsertFeedItem> = {}): InsertFeedItem {
  return {
    title: guid,
    description: null,
    url: null,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    guid,
    isBreaking: false,
    imageUrl: null,
    ...overrides,
  };
}

describe("updateEmbeddings + searchSemantic (PGlite + vector)", () => {
  let storage: DatabaseStorage;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;
  });

  afterAll(async () => {
    await storage.close();
  });

  it("round-trips an embedding through updateEmbeddings", async () => {
    const item = await storage.createFeedItem(makeItem("emb-roundtrip"));
    const vec = unitVector(3);
    await storage.updateEmbeddings([{ id: item.id, embedding: vec }]);

    const fetched = await storage.getFeedItemById(item.id);
    // Drizzle's vector type parses pgvector output back into a number[].
    expect(fetched!.embedding).toEqual(vec);
  });

  it("ranks searchSemantic results by cosine distance ascending", async () => {
    const xAxis = await storage.createFeedItem(makeItem("vec-x"));
    const yAxis = await storage.createFeedItem(makeItem("vec-y"));
    const xishAxis = await storage.createFeedItem(makeItem("vec-xish"));

    await storage.updateEmbeddings([
      { id: xAxis.id, embedding: unitVector(0) },
      { id: yAxis.id, embedding: unitVector(1) },
      // Mostly-x with a small y component: closest to the x query, far from pure y.
      { id: xishAxis.id, embedding: (() => { const v = unitVector(0); v[1] = 0.1; return v; })() },
    ]);

    const results = await storage.searchSemantic(unitVector(0), { limit: 10 });
    const ranked = results
      .filter((r) => ["vec-x", "vec-y", "vec-xish"].includes(r.guid))
      .map((r) => r.guid);

    // Exact x match first, the x-ish vector next, pure y last.
    expect(ranked[0]).toBe("vec-x");
    expect(ranked.indexOf("vec-xish")).toBeLessThan(ranked.indexOf("vec-y"));
  });

  it("excludes rows without an embedding from searchSemantic", async () => {
    await storage.createFeedItem(makeItem("no-embedding"));
    const results = await storage.searchSemantic(unitVector(0), { limit: 50 });
    expect(results.some((r) => r.guid === "no-embedding")).toBe(false);
  });

  it("applies category and source equality filters when provided", async () => {
    const a = await storage.createFeedItem(
      makeItem("filt-policy-openai", { category: "policy", source: "openai", sourceLabel: "OpenAI" }),
    );
    const b = await storage.createFeedItem(
      makeItem("filt-policy-meta", { category: "policy", source: "meta_ai", sourceLabel: "Meta AI" }),
    );
    const c = await storage.createFeedItem(
      makeItem("filt-research-openai", { category: "research", source: "openai", sourceLabel: "OpenAI" }),
    );
    await storage.updateEmbeddings([
      { id: a.id, embedding: unitVector(5) },
      { id: b.id, embedding: unitVector(5) },
      { id: c.id, embedding: unitVector(5) },
    ]);

    const byCategory = await storage.searchSemantic(unitVector(5), { limit: 50, category: "policy" });
    const catGuids = byCategory.map((r) => r.guid);
    expect(catGuids).toContain("filt-policy-openai");
    expect(catGuids).toContain("filt-policy-meta");
    expect(catGuids).not.toContain("filt-research-openai");

    const byBoth = await storage.searchSemantic(unitVector(5), {
      limit: 50,
      category: "policy",
      source: "openai",
    });
    const bothGuids = byBoth.map((r) => r.guid);
    expect(bothGuids).toContain("filt-policy-openai");
    expect(bothGuids).not.toContain("filt-policy-meta");
    expect(bothGuids).not.toContain("filt-research-openai");

    // "all" sentinels are treated as no-op filters.
    const allCat = await storage.searchSemantic(unitVector(5), { limit: 50, category: "all", source: "all" });
    const allGuids = allCat.map((r) => r.guid);
    expect(allGuids).toContain("filt-policy-openai");
    expect(allGuids).toContain("filt-research-openai");
  });
});

describe("getRelatedItems (PGlite + vector)", () => {
  let storage: DatabaseStorage;
  let sourceId: number;
  let nearId: number;
  let sameClusterId: number;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const source = await storage.createFeedItem(makeItem("rel-source"));
    const near = await storage.createFeedItem(makeItem("rel-near", { source: "techcrunch" }));
    const sameCluster = await storage.createFeedItem(
      makeItem("rel-same-cluster", { source: "theverge" }),
    );
    const far = await storage.createFeedItem(makeItem("rel-far", { source: "venturebeat" }));
    sourceId = source.id;
    nearId = near.id;
    sameClusterId = sameCluster.id;

    // source and its same-cluster sibling share a clusterId.
    await storage.bulkUpdateClusterIds([
      { id: sourceId, clusterId: "story-rel" },
      { id: sameClusterId, clusterId: "story-rel" },
    ]);

    const nearVec = (() => { const v = unitVector(0); v[1] = 0.05; return v; })();
    await storage.updateEmbeddings([
      { id: sourceId, embedding: unitVector(0) },
      { id: nearId, embedding: nearVec },
      { id: sameClusterId, embedding: unitVector(0) }, // identical, but same cluster
      { id: far.id, embedding: unitVector(900) },
    ]);
  });

  afterAll(async () => {
    await storage.close();
  });

  it("returns nearest items excluding self and same-cluster members", async () => {
    const related = await storage.getRelatedItems(sourceId, 5);
    const ids = related.map((r) => r.id);

    expect(ids).not.toContain(sourceId); // self excluded
    expect(ids).not.toContain(sameClusterId); // same cluster excluded
    expect(ids[0]).toBe(nearId); // nearest non-cluster neighbor ranks first
  });

  it("returns empty when the source item has no embedding", async () => {
    const noEmb = await storage.createFeedItem(makeItem("rel-no-emb", { source: "cohere" }));
    expect(await storage.getRelatedItems(noEmb.id)).toEqual([]);
  });
});
