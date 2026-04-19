import type { FeedItem } from "@shared/schema";
import { storage } from "./storage";

const SIMILARITY_THRESHOLD = 0.35;

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

      for (const other of sorted) {
        if (assigned.has(other.id)) continue;
        if (item.source === other.source) continue;

        const sim = jaccard(itemTri, trigramCache.get(other.id)!);
        if (sim > SIMILARITY_THRESHOLD) {
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
