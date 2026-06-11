import { describe, it, expect } from "vitest";
import { computePriority } from "../../server/priority";
import type { FeedItem } from "../../shared/schema";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 1,
    title: "Test title",
    description: null,
    url: null,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    guid: "test-1",
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 0,
    readAt: null,
    embedding: null,
    ...overrides,
  };
}

describe("computePriority", () => {
  it("ceiling caps at 100", () => {
    const item = makeItem({
      title: "Launch release announce introduce unveil open-source state-of-the-art",
      description: "breakthrough benchmark outperform surpass",
      source: "openai",
      category: "model_release",
      publishedAt: new Date().toISOString(),
    });
    expect(computePriority(item, 10)).toBeLessThanOrEqual(100);
  });

  it("recent + high-authority + cross-coverage beats low-authority + old", () => {
    const hot = makeItem({
      source: "anthropic",
      category: "model_release",
      publishedAt: new Date().toISOString(),
      title: "Claude launch announcement",
    });
    const cold = makeItem({
      source: "community",
      category: "policy",
      publishedAt: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
      title: "Random opinion piece",
    });
    expect(computePriority(hot, 3)).toBeGreaterThan(computePriority(cold, 1));
  });

  it("coverage contribution caps at 30 points", () => {
    const item = makeItem({
      source: "community",
      category: "funding",
      publishedAt: new Date(Date.now() - 80 * 3600 * 1000).toISOString(),
      title: "plain title",
    });
    const p1 = computePriority(item, 1);
    const p10 = computePriority(item, 10);
    expect(p10 - p1).toBeLessThanOrEqual(30);
    expect(p10 - p1).toBeGreaterThan(15);
  });

  it("unknown source falls back to neutral authority", () => {
    const item = makeItem({
      source: "some_unknown_outlet",
      category: "product",
      publishedAt: new Date().toISOString(),
    });
    const score = computePriority(item, 1);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("recency bands: <1h > 6h > 24h > 48h", () => {
    const base = {
      source: "community",
      category: "product",
      title: "x",
    };
    const now = makeItem({ ...base, publishedAt: new Date().toISOString() });
    const h6 = makeItem({ ...base, publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
    const h24 = makeItem({ ...base, publishedAt: new Date(Date.now() - 12 * 3600_000).toISOString() });
    const h48 = makeItem({ ...base, publishedAt: new Date(Date.now() - 36 * 3600_000).toISOString() });
    expect(computePriority(now, 1)).toBeGreaterThan(computePriority(h6, 1));
    expect(computePriority(h6, 1)).toBeGreaterThan(computePriority(h24, 1));
    expect(computePriority(h24, 1)).toBeGreaterThan(computePriority(h48, 1));
  });
});
