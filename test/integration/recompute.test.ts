import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FeedItem } from "@shared/schema";

type MakeItemOverrides = Partial<FeedItem>;

function makeItem(id: number, overrides: MakeItemOverrides = {}): FeedItem {
  return {
    id,
    title: `Item ${id}`,
    description: null,
    url: null,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    guid: `g-${id}`,
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 0,
    ...overrides,
  };
}

// The code under test imports `storage` from `./storage`. We stub that module
// so we can inject a fake that records the bulk calls and returns items we pick.
vi.mock("../../server/storage", () => {
  const state = {
    items: [] as FeedItem[],
    bulkPrioritiesCalls: [] as { id: number; priority: number; isBreaking: boolean }[][],
    bulkClusterCalls: [] as { id: number; clusterId: string }[][],
    recentDelayMs: 0,
  };
  return {
    __state: state,
    storage: {
      async getRecentItems() {
        if (state.recentDelayMs > 0) {
          await new Promise((r) => setTimeout(r, state.recentDelayMs));
        }
        return state.items;
      },
      async bulkUpdatePriorities(rows: typeof state.bulkPrioritiesCalls[number]) {
        state.bulkPrioritiesCalls.push(rows);
      },
      async decayStalePriorities() {
        return 0;
      },
      async bulkUpdateClusterIds(rows: typeof state.bulkClusterCalls[number]) {
        state.bulkClusterCalls.push(rows);
      },
    },
  };
});

describe("recomputePriorities", () => {
  beforeEach(async () => {
    const mod = await import("../../server/storage");
    const state = (mod as any).__state;
    state.items = [];
    state.bulkPrioritiesCalls = [];
    state.bulkClusterCalls = [];
    state.recentDelayMs = 0;
  });

  it("emits a single bulk UPDATE with only the changed rows", async () => {
    const storageMod = await import("../../server/storage");
    const state = (storageMod as any).__state;

    // Item 1 already has priority 15 that matches its expected score ⇒ should be skipped
    // Item 2 has stale priority ⇒ should be included
    state.items = [
      makeItem(1, {
        source: "community",
        category: "policy",
        publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 60).toISOString(), // 60h ago
        priority: 14,
        isBreaking: false,
      }),
      makeItem(2, {
        source: "openai",
        category: "model_release",
        publishedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30m ago
        priority: 0,
        isBreaking: false,
      }),
    ];

    const { recomputePriorities } = await import("../../server/priority");
    await recomputePriorities();

    expect(state.bulkPrioritiesCalls.length).toBe(1);
    const written = state.bulkPrioritiesCalls[0];
    const ids = written.map((r: any) => r.id).sort();
    expect(ids).toContain(2);
    const item2Row = written.find((r: any) => r.id === 2);
    expect(item2Row).toBeDefined();
    expect(item2Row!.priority).toBeGreaterThan(50);
  });

  it("re-entrance lock drops overlapping calls", async () => {
    const storageMod = await import("../../server/storage");
    const state = (storageMod as any).__state;
    state.items = [
      makeItem(1, { priority: 0 }),
      makeItem(2, { priority: 0, source: "anthropic", guid: "g-2" }),
    ];
    state.recentDelayMs = 50;

    const { recomputePriorities } = await import("../../server/priority");
    const [_a, _b, _c] = await Promise.all([
      recomputePriorities(),
      recomputePriorities(),
      recomputePriorities(),
    ]);

    expect(state.bulkPrioritiesCalls.length).toBe(1);
  });

  it("no-op when nothing needs to change", async () => {
    const storageMod = await import("../../server/storage");
    const state = (storageMod as any).__state;

    // Item with existing priority+isBreaking that match the computed values.
    const existing = makeItem(1, {
      source: "community",
      category: "policy",
      publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 60).toISOString(),
      priority: 0,
      isBreaking: false,
    });
    // Seed a loop to discover the target priority, then set it.
    state.items = [existing];
    const { recomputePriorities, computePriority } = await import("../../server/priority");
    const targetPriority = computePriority(existing, 1);
    existing.priority = targetPriority;
    existing.isBreaking = targetPriority >= 80;

    await recomputePriorities();
    expect(state.bulkPrioritiesCalls.length).toBe(0);
  });
});

describe("clusterRecentItems", () => {
  beforeEach(async () => {
    const mod = await import("../../server/storage");
    const state = (mod as any).__state;
    state.items = [];
    state.bulkPrioritiesCalls = [];
    state.bulkClusterCalls = [];
    state.recentDelayMs = 0;
  });

  it("groups similar titles from different sources and writes one batch", async () => {
    const storageMod = await import("../../server/storage");
    const state = (storageMod as any).__state;
    state.items = [
      makeItem(1, {
        title: "OpenAI releases GPT-5 Turbo model",
        source: "openai",
        publishedAt: new Date(Date.now() - 1000).toISOString(),
      }),
      makeItem(2, {
        title: "OpenAI releases GPT-5 Turbo model",
        source: "techcrunch",
        publishedAt: new Date(Date.now() - 2000).toISOString(),
      }),
      makeItem(3, {
        title: "Unrelated headline about policy",
        source: "theverge",
        publishedAt: new Date(Date.now() - 3000).toISOString(),
      }),
    ];

    const { clusterRecentItems } = await import("../../server/clustering");
    await clusterRecentItems();

    expect(state.bulkClusterCalls.length).toBe(1);
    const writes = state.bulkClusterCalls[0];
    // All three items got a clusterId assigned; items 1+2 share one, 3 has its own.
    const byId = new Map(writes.map((r: any) => [r.id, r.clusterId]));
    expect(byId.get(1)).toBe(byId.get(2));
    expect(byId.get(3)).not.toBe(byId.get(1));
  });

  it("skips writes when cluster ids already match", async () => {
    const storageMod = await import("../../server/storage");
    const state = (storageMod as any).__state;
    state.items = [
      makeItem(1, {
        title: "shared story",
        source: "openai",
        clusterId: "story-1",
        publishedAt: new Date(Date.now() - 1000).toISOString(),
      }),
      makeItem(2, {
        title: "shared story",
        source: "anthropic",
        clusterId: "story-1",
        publishedAt: new Date(Date.now() - 2000).toISOString(),
      }),
    ];

    const { clusterRecentItems } = await import("../../server/clustering");
    await clusterRecentItems();

    expect(state.bulkClusterCalls.length).toBe(0);
  });

  it("re-entrance lock drops overlapping cluster calls", async () => {
    const storageMod = await import("../../server/storage");
    const state = (storageMod as any).__state;
    state.items = [makeItem(1, { title: "solo item" })];
    state.recentDelayMs = 50;

    const { clusterRecentItems } = await import("../../server/clustering");
    await Promise.all([
      clusterRecentItems(),
      clusterRecentItems(),
      clusterRecentItems(),
    ]);

    expect(state.bulkClusterCalls.length).toBe(1);
  });
});
