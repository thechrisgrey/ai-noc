import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage, SourceIntelRow } from "../../server/storage";

/**
 * First-mover leaderboard. Two multi-source clusters with known publish
 * orderings plus a solo item, so we can assert firsts/contested counts, the
 * median trailing lag, that ties both score as firsts, and that sources which
 * only ever appear alone in a cluster are excluded.
 *
 * Cluster A (story-a): openai @ t0, anthropic @ +1h, meta_ai @ +2h
 * Cluster B (story-b): openai @ t0, anthropic @ t0 (tie), meta_ai @ +1h
 * Solo     (story-c): nvidia alone
 */
describe("getSourceIntel first-mover leaderboard", () => {
  let storage: DatabaseStorage;
  // Anchor all items a few hours before "now" so any sensible window includes
  // them; offsets stay small so the relative ordering is what is under test.
  const base = Date.now() - 6 * 60 * 60 * 1000;
  const at = (offsetSeconds: number) => new Date(base + offsetSeconds * 1000).toISOString();

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;

    const make = async (
      guid: string,
      source: string,
      clusterId: string,
      publishedAt: string,
    ) => {
      const item = await storage.createFeedItem({
        title: guid, description: null, url: null,
        source, sourceLabel: source.toUpperCase(), category: "product",
        publishedAt,
        fetchedAt: new Date().toISOString(), guid, isBreaking: false, imageUrl: null,
      });
      await storage.updateClusterId(item.id, clusterId);
    };

    // Cluster A: clean ordering, no ties.
    await make("a-openai", "openai", "story-a", at(0));
    await make("a-anthropic", "anthropic", "story-a", at(3600));
    await make("a-meta", "meta_ai", "story-a", at(7200));

    // Cluster B: openai and anthropic tie for first.
    await make("b-openai", "openai", "story-b", at(0));
    await make("b-anthropic", "anthropic", "story-b", at(0));
    await make("b-meta", "meta_ai", "story-b", at(3600));

    // Solo cluster: nvidia is alone, so it never contributes to the leaderboard.
    await make("c-nvidia", "nvidia", "story-c", at(0));
  });

  afterAll(async () => {
    await storage.close();
  });

  function bySource(rows: SourceIntelRow[]): Record<string, SourceIntelRow> {
    return Object.fromEntries(rows.map((r) => [r.source, r]));
  }

  it("scores firsts, contested, ties, and excludes solo-only sources", async () => {
    const rows = await storage.getSourceIntel(90);
    const m = bySource(rows);

    // Solo-only source never enters the leaderboard.
    expect(m.nvidia).toBeUndefined();
    expect(rows.map((r) => r.source).sort()).toEqual(["anthropic", "meta_ai", "openai"]);

    // openai is first in both clusters (and never trails): firsts 2, no lag.
    expect(m.openai.firsts).toBe(2);
    expect(m.openai.contested).toBe(2);
    expect(m.openai.medianLagSeconds).toBeNull();

    // anthropic ties for first in B (counts as a first) and trails by 1h in A.
    expect(m.anthropic.firsts).toBe(1);
    expect(m.anthropic.contested).toBe(2);
    expect(m.anthropic.medianLagSeconds).toBe(3600);

    // meta_ai trails in both: median of [3600, 7200] = 5400.
    expect(m.meta_ai.firsts).toBe(0);
    expect(m.meta_ai.contested).toBe(2);
    expect(m.meta_ai.medianLagSeconds).toBe(5400);
  });

  it("carries the source label through and orders by firsts descending", async () => {
    const rows = await storage.getSourceIntel(90);
    expect(rows[0].source).toBe("openai");
    expect(rows[0].sourceLabel).toBe("OPENAI");
    // firsts is non-increasing down the list.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].firsts).toBeGreaterThanOrEqual(rows[i].firsts);
    }
  });

  it("returns [] when there are no clustered items in the window", async () => {
    const { storage: empty } = await createTestStorage();
    try {
      const rows = await empty.getSourceIntel(30);
      expect(rows).toEqual([]);
    } finally {
      await empty.close();
    }
  });
});
