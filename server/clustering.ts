import type { FeedItem } from "@shared/schema";
import { storage } from "./storage";
import { cosineSim } from "./embeddings";

const SIMILARITY_THRESHOLD = 0.35;
// Cosine threshold for embedding-based clustering; same-source pairs need a
// much higher bar (0.92) since at that point a match is a dedup signal rather
// than independent coverage of the same story.
const CLUSTER_SIM_THRESHOLD = parseFloat(
  process.env.CLUSTER_SIM_THRESHOLD || "0.80",
);
const SAME_SOURCE_DEDUP_THRESHOLD = 0.92;

function trigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const result = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) {
    result.add(s.substring(i, i + 3));
  }
  return result;
}

/** Jaccard similarity between two trigram sets */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  a.forEach((t) => {
    if (b.has(t)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Jaccard similarity between two strings based on trigrams */
export function similarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b));
}

/**
 * Normalize an item's embedding to number[] | null. Drizzle's vector type
 * returns an array; some drivers may surface the pgvector text literal.
 */
function embeddingOf(item: FeedItem): number[] | null {
  const e = item.embedding as unknown;
  if (Array.isArray(e) && e.length > 0) return e as number[];
  if (typeof e === "string" && e.length > 2) {
    const parsed = e.slice(1, -1).split(",").map(Number);
    return parsed.every((n) => Number.isFinite(n)) ? parsed : null;
  }
  return null;
}

let isClustering = false;

/**
 * Cluster recent feed items by title similarity across different sources.
 * Re-entrance-guarded: overlapping calls are dropped.
 * Trigrams are memoized once per pass; writes are batched via bulk update.
 */
export async function clusterRecentItems(): Promise<void> {
  if (isClustering) {
    console.log("[Clustering] Skip — clustering already in flight");
    return;
  }
  isClustering = true;
  try {
    const items = await storage.getRecentItems(72);
    if (items.length === 0) return;

    const assigned = new Set<number>();
    const updates: { id: number; clusterId: string }[] = [];

    // Sort by publishedAt DESC — newest item becomes cluster representative
    const sorted = [...items].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );

    // Memoize trigrams once per item for this pass
    const trigramCache = new Map<number, Set<string>>();
    for (const item of sorted) {
      trigramCache.set(item.id, trigrams(item.title));
    }

    let clusterCount = 0;
    let mergedCount = 0;

    for (const item of sorted) {
      if (assigned.has(item.id)) continue;

      const clusterId = `story-${item.id}`;
      assigned.add(item.id);
      if (clusterId !== item.clusterId) {
        updates.push({ id: item.id, clusterId });
      }

      const itemTri = trigramCache.get(item.id)!;
      const itemVec = embeddingOf(item);

      for (const other of sorted) {
        if (assigned.has(other.id)) continue;

        const otherVec = embeddingOf(other);
        let matched = false;
        if (itemVec && otherVec) {
          // Both embedded: cosine drives clustering across all sources; a
          // same-source pair must clear the stricter dedup bar to merge.
          const sim = cosineSim(itemVec, otherVec);
          const threshold =
            item.source === other.source
              ? SAME_SOURCE_DEDUP_THRESHOLD
              : CLUSTER_SIM_THRESHOLD;
          matched = sim > threshold;
        } else {
          // Fallback to trigram title similarity across distinct sources only.
          if (item.source === other.source) continue;
          matched = jaccard(itemTri, trigramCache.get(other.id)!) > SIMILARITY_THRESHOLD;
        }

        if (matched) {
          assigned.add(other.id);
          if (clusterId !== other.clusterId) {
            updates.push({ id: other.id, clusterId });
          }
          mergedCount++;
        }
      }

      clusterCount++;
    }

    if (updates.length > 0) {
      await storage.bulkUpdateClusterIds(updates);
    }

    console.log(
      `[Clustering] ${items.length} items → ${clusterCount} stories (${mergedCount} merged, ${updates.length} writes)`,
    );
  } finally {
    isClustering = false;
  }
}

/** Get coverage count for a given clusterId */
export async function getCoverageCount(clusterId: string | null): Promise<number> {
  if (!clusterId) return 1;
  const items = await storage.getRecentItems(72);
  return items.filter((i) => i.clusterId === clusterId).length;
}
