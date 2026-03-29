import type { FeedItem } from "@shared/schema";
import { storage } from "./storage";

const SIMILARITY_THRESHOLD = 0.35;

/** Extract trigrams from a normalized string */
function trigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const result = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) {
    result.add(s.substring(i, i + 3));
  }
  return result;
}

/** Jaccard similarity between two strings based on trigrams */
export function similarity(a: string, b: string): number {
  const triA = trigrams(a);
  const triB = trigrams(b);
  if (triA.size === 0 || triB.size === 0) return 0;

  let intersection = 0;
  triA.forEach((t) => {
    if (triB.has(t)) intersection++;
  });

  const union = triA.size + triB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Cluster recent feed items by title similarity across different sources */
export async function clusterRecentItems(): Promise<void> {
  const items = await storage.getRecentItems(72);
  if (items.length === 0) return;

  const assigned = new Set<number>();

  // Sort by publishedAt DESC — newest item becomes cluster representative
  const sorted = [...items].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  let clusterCount = 0;
  let mergedCount = 0;

  for (const item of sorted) {
    if (assigned.has(item.id)) continue;

    const clusterId = `story-${item.id}`;
    assigned.add(item.id);
    await storage.updateClusterId(item.id, clusterId);

    // Find similar items from DIFFERENT sources
    for (const other of sorted) {
      if (assigned.has(other.id)) continue;
      if (item.source === other.source) continue; // same source = not a dup

      const sim = similarity(item.title, other.title);
      if (sim > SIMILARITY_THRESHOLD) {
        assigned.add(other.id);
        await storage.updateClusterId(other.id, clusterId);
        mergedCount++;
      }
    }

    clusterCount++;
  }

  console.log(
    `[Clustering] ${items.length} items → ${clusterCount} stories (${mergedCount} merged)`,
  );
}

/** Get coverage count for a given clusterId */
export async function getCoverageCount(clusterId: string | null): Promise<number> {
  if (!clusterId) return 1;
  const items = await storage.getRecentItems(72);
  return items.filter((i) => i.clusterId === clusterId).length;
}
