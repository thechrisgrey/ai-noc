import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FeedItem } from "@shared/schema";

// clusterRecentItems pulls items from and writes clusters to the `storage`
// module; stub it so we can inject hand-built items and capture the writes.
vi.mock("../../server/storage", () => {
  const state = {
    items: [] as FeedItem[],
    bulkClusterCalls: [] as { id: number; clusterId: string }[][],
  };
  return {
    __state: state,
    storage: {
      async getRecentItems() {
        return state.items;
      },
      async bulkUpdateClusterIds(rows: { id: number; clusterId: string }[]) {
        state.bulkClusterCalls.push(rows);
      },
    },
  };
});

function makeItem(id: number, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    title: `Item ${id}`,
    description: null,
    url: null,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: new Date(Date.now() - id * 1000).toISOString(),
    fetchedAt: new Date().toISOString(),
    guid: `g-${id}`,
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 0,
    readAt: null,
    embedding: null,
    ...overrides,
  };
}

/**
 * Build a deterministic near-unit 1024-d vector pointing mostly along axis
 * `axis`, nudged by `jitter` so two such vectors are near-identical but not
 * exactly equal — mirrors normalized Titan output.
 */
function nearVector(axis: number, jitter = 0): number[] {
  const v = new Array(1024).fill(0);
  v[axis] = 1;
  v[(axis + 1) % 1024] = jitter;
  return v;
}

async function getState() {
  const mod = await import("../../server/storage");
  return (mod as any).__state as {
    items: FeedItem[];
    bulkClusterCalls: { id: number; clusterId: string }[][];
  };
}

describe("clusterRecentItems with embeddings", () => {
  beforeEach(async () => {
    const state = await getState();
    state.items = [];
    state.bulkClusterCalls = [];
  });

  it("clusters items with near-identical embeddings despite dissimilar titles", async () => {
    const state = await getState();
    // Titles share almost no trigrams, so the trigram path would never merge
    // these — the embedding path must.
    state.items = [
      makeItem(1, {
        title: "Anthropic unveils frontier reasoning system",
        source: "anthropic",
        embedding: nearVector(42, 0.01),
      }),
      makeItem(2, {
        title: "New AI breakthrough from the Claude maker today",
        source: "techcrunch",
        embedding: nearVector(42, 0.02),
      }),
    ];

    const { clusterRecentItems } = await import("../../server/clustering");
    await clusterRecentItems();

    expect(state.bulkClusterCalls.length).toBe(1);
    const writes = state.bulkClusterCalls[0];
    const clusterIds = new Set(writes.map((w) => w.clusterId));
    // Both items land in the same cluster.
    expect(clusterIds.size).toBe(1);
    expect(writes.map((w) => w.id).sort()).toEqual([1, 2]);
  });

  it("does NOT cluster items whose embeddings point in different directions", async () => {
    const state = await getState();
    state.items = [
      makeItem(1, { source: "anthropic", embedding: nearVector(0) }),
      makeItem(2, { source: "techcrunch", embedding: nearVector(500) }),
    ];

    const { clusterRecentItems } = await import("../../server/clustering");
    await clusterRecentItems();

    // Only the representative self-assignment(s) — never a merge into one id.
    const writes = state.bulkClusterCalls[0] ?? [];
    const clusterIds = new Set(writes.map((w) => w.clusterId));
    expect(clusterIds.size).toBe(2);
  });

  it("keeps same-source embedding pairs apart unless they clear the 0.92 dedup bar", async () => {
    const state = await getState();
    // Cosine ~0.85 (above the 0.80 cross-source bar, below the 0.92 same-source
    // dedup bar) between two same-source items ⇒ must stay separate.
    const a = new Array(1024).fill(0);
    a[10] = 1;
    const b = new Array(1024).fill(0);
    b[10] = 1;
    b[11] = 0.62; // cos = 1 / sqrt(1 + 0.62^2) ≈ 0.85
    state.items = [
      makeItem(1, { source: "openai", embedding: a }),
      makeItem(2, { source: "openai", embedding: b }),
    ];

    const { clusterRecentItems } = await import("../../server/clustering");
    await clusterRecentItems();

    const writes = state.bulkClusterCalls[0] ?? [];
    const clusterIds = new Set(writes.map((w) => w.clusterId));
    expect(clusterIds.size).toBe(2);
  });

  it("falls back to trigram similarity for rows without embeddings", async () => {
    const state = await getState();
    state.items = [
      makeItem(1, {
        title: "OpenAI launches GPT-5 with improved reasoning",
        source: "openai",
        embedding: null,
      }),
      makeItem(2, {
        title: "OpenAI launches GPT-5 with improved reasoning capabilities",
        source: "techcrunch",
        embedding: null,
      }),
    ];

    const { clusterRecentItems } = await import("../../server/clustering");
    await clusterRecentItems();

    const writes = state.bulkClusterCalls[0];
    const clusterIds = new Set(writes.map((w) => w.clusterId));
    expect(clusterIds.size).toBe(1);
    expect(writes.map((w) => w.id).sort()).toEqual([1, 2]);
  });
});
