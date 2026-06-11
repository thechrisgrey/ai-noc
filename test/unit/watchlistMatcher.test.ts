import { describe, it, expect } from "vitest";
import {
  matchesWatchlist,
  evaluateWatchlists,
  WATCHLIST_SIM_THRESHOLD,
} from "../../server/watchlistMatcher";
import type { FeedItem, Watchlist } from "@shared/schema";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 1,
    title: "OpenAI ships GPT-6",
    description: "A new flagship model with longer context.",
    url: null,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: "2026-06-10T00:00:00.000Z",
    fetchedAt: "2026-06-10T00:00:00.000Z",
    guid: "g1",
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 50,
    readAt: null,
    embedding: null,
    ...overrides,
  };
}

function makeWatchlist(overrides: Partial<Watchlist> = {}): Watchlist {
  return {
    id: 1,
    name: "wl",
    category: null,
    source: null,
    search: null,
    sort: null,
    alert: true,
    lastTriggeredAt: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("matchesWatchlist truth table", () => {
  it("a filterless watchlist never matches", () => {
    expect(matchesWatchlist(makeItem(), makeWatchlist())).toBe(false);
  });

  it("category equality matches and mismatches", () => {
    expect(matchesWatchlist(makeItem(), makeWatchlist({ category: "model_release" }))).toBe(true);
    expect(matchesWatchlist(makeItem(), makeWatchlist({ category: "policy" }))).toBe(false);
  });

  it("source equality matches and mismatches", () => {
    expect(matchesWatchlist(makeItem(), makeWatchlist({ source: "openai" }))).toBe(true);
    expect(matchesWatchlist(makeItem(), makeWatchlist({ source: "anthropic" }))).toBe(false);
  });

  it("category AND source must both hold", () => {
    const wl = makeWatchlist({ category: "model_release", source: "anthropic" });
    expect(matchesWatchlist(makeItem(), wl)).toBe(false);
    const wl2 = makeWatchlist({ category: "model_release", source: "openai" });
    expect(matchesWatchlist(makeItem(), wl2)).toBe(true);
  });

  it("search matches case-insensitive substring on title", () => {
    expect(matchesWatchlist(makeItem(), makeWatchlist({ search: "gpt-6" }))).toBe(true);
    expect(matchesWatchlist(makeItem(), makeWatchlist({ search: "GPT-6" }))).toBe(true);
  });

  it("search matches substring on description", () => {
    expect(matchesWatchlist(makeItem(), makeWatchlist({ search: "longer context" }))).toBe(true);
  });

  it("search misses when neither title nor description contains it", () => {
    expect(matchesWatchlist(makeItem(), makeWatchlist({ search: "quantum" }))).toBe(false);
  });

  it("search combines with category as AND", () => {
    const wl = makeWatchlist({ category: "policy", search: "gpt-6" });
    expect(matchesWatchlist(makeItem(), wl)).toBe(false);
  });

  it("semantic path matches when embeddings are near-identical and lexical misses", () => {
    // Identical unit vectors: cosine == 1 > threshold. Search term is absent
    // from the text so only the semantic path can produce a hit.
    const vec = [1, 0, 0];
    const item = makeItem({ embedding: vec as unknown as FeedItem["embedding"] });
    const wl = makeWatchlist({ search: "totally-absent-term" });
    expect(matchesWatchlist(item, wl, vec)).toBe(true);
  });

  it("semantic path misses when vectors are orthogonal", () => {
    const item = makeItem({ embedding: [1, 0, 0] as unknown as FeedItem["embedding"] });
    const wl = makeWatchlist({ search: "totally-absent-term" });
    expect(matchesWatchlist(item, wl, [0, 1, 0])).toBe(false);
  });

  it("lexical hit short-circuits the semantic check (no embedding needed)", () => {
    const item = makeItem({ embedding: null });
    const wl = makeWatchlist({ search: "gpt-6" });
    expect(matchesWatchlist(item, wl, [0, 1, 0])).toBe(true);
  });

  it("semantic path is skipped when the item has no embedding", () => {
    const item = makeItem({ embedding: null });
    const wl = makeWatchlist({ search: "totally-absent-term" });
    expect(matchesWatchlist(item, wl, [1, 0, 0])).toBe(false);
  });

  it("the similarity threshold is the stricter 0.78", () => {
    expect(WATCHLIST_SIM_THRESHOLD).toBe(0.78);
  });
});

describe("evaluateWatchlists", () => {
  it("maps each watchlist to only the items that hit it; misses are omitted", () => {
    const items = [
      makeItem({ id: 1, source: "openai", category: "model_release", title: "OpenAI launch" }),
      makeItem({ id: 2, source: "anthropic", category: "research", title: "Anthropic paper" }),
      makeItem({ id: 3, source: "openai", category: "policy", title: "OpenAI policy note" }),
    ];
    const watchlists = [
      makeWatchlist({ id: 10, source: "openai" }),
      makeWatchlist({ id: 20, category: "research" }),
      makeWatchlist({ id: 30, source: "google_ai" }),
    ];

    const result = evaluateWatchlists(items, watchlists, new Map());

    expect(result.get(10)?.map((i) => i.id)).toEqual([1, 3]);
    expect(result.get(20)?.map((i) => i.id)).toEqual([2]);
    expect(result.has(30)).toBe(false);
  });

  it("uses per-watchlist embeddings from the supplied map", () => {
    const vec = [1, 0, 0];
    const items = [
      makeItem({ id: 1, title: "no lexical overlap here", embedding: vec as unknown as FeedItem["embedding"] }),
    ];
    const wl = makeWatchlist({ id: 5, search: "absent" });
    const embeddings = new Map<number, number[]>([[5, vec]]);

    const result = evaluateWatchlists(items, [wl], embeddings);
    expect(result.get(5)?.map((i) => i.id)).toEqual([1]);
  });
});
