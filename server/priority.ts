import type { FeedItem } from "@shared/schema";
import { PRIORITY_ALERT_THRESHOLD } from "@shared/constants";
import { storage } from "./storage";
import { similarity } from "./clustering";

const SOURCE_AUTHORITY: Record<string, number> = {
  anthropic: 95,
  openai: 95,
  google_ai: 90,
  meta_ai: 90,
  anthropic_gh: 90,
  openai_gh: 85,
  mistral: 85,
  nvidia: 80,
  cohere: 80,
  huggingface: 80,
  hf_transformers: 75,
  google_gh: 75,
  mistral_gh: 75,
  meta_gh: 75,
  arxiv_ai: 70,
  arxiv_ml: 70,
  arxiv_nlp: 70,
  techcrunch: 65,
  theverge: 60,
  venturebeat: 60,
  simonwillison: 60,
  the_decoder: 55,
  marktechpost: 50,
  community: 40,
};

const CATEGORY_WEIGHT: Record<string, number> = {
  model_release: 15,
  research: 12,
  infrastructure: 10,
  product: 8,
  funding: 7,
  policy: 6,
};

const HIGH_VALUE_KEYWORDS = [
  "launch", "release", "announce", "introduce", "unveil",
  "breakthrough", "state-of-the-art", "open-source", "open source",
  "benchmark", "outperform", "surpass",
];

/**
 * Compute priority score (0-100) for a feed item.
 *
 * Scoring breakdown:
 *   Cross-source coverage: 30 points max (coverageCount * 10, capped)
 *   Source authority:       20 points max
 *   Keyword intensity:      20 points max (5 per match, capped)
 *   Recency:               15 points max
 *   Category relevance:    15 points max
 */
export function computePriority(item: FeedItem, coverageCount: number): number {
  let score = 0;

  score += Math.min(coverageCount * 10, 30);

  const authority = SOURCE_AUTHORITY[item.source] ?? 50;
  score += (authority / 100) * 20;

  const text = `${item.title} ${item.description || ""}`.toLowerCase();
  const matches = HIGH_VALUE_KEYWORDS.filter((kw) => text.includes(kw)).length;
  score += Math.min(matches * 5, 20);

  const hoursAgo =
    (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 1) score += 15;
  else if (hoursAgo < 6) score += 12;
  else if (hoursAgo < 24) score += 8;
  else if (hoursAgo < 48) score += 4;

  score += CATEGORY_WEIGHT[item.category] ?? 5;

  return Math.round(Math.min(score, 100));
}

/**
 * Build a Map of clusterId -> count of items in that cluster.
 * Items without a clusterId are skipped.
 */
function buildClusterCoverageMap(items: FeedItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!item.clusterId) continue;
    map.set(item.clusterId, (map.get(item.clusterId) ?? 0) + 1);
  }
  return map;
}

/**
 * Coverage for a single item.
 *   - Clustered items: O(1) Map lookup.
 *   - Unclustered items: title-similarity sweep across distinct sources (fallback).
 */
function getCoverageCount(
  item: FeedItem,
  allRecent: FeedItem[],
  clusterMap: Map<string, number>,
): number {
  if (item.clusterId) {
    return clusterMap.get(item.clusterId) ?? 1;
  }
  let count = 1;
  for (const other of allRecent) {
    if (other.id === item.id) continue;
    if (other.source === item.source) continue;
    if (similarity(item.title, other.title) > 0.35) count++;
  }
  return count;
}

let isRecomputing = false;

/**
 * Recompute priorities for all items in the last 72 hours.
 * Re-entrance-guarded: overlapping calls are dropped.
 */
export async function recomputePriorities(): Promise<void> {
  if (isRecomputing) {
    console.log("[Priority] Skip — recompute already in flight");
    return;
  }
  isRecomputing = true;
  try {
    const items = await storage.getRecentItems(72);

    const clusterMap = buildClusterCoverageMap(items);
    const diffs: { id: number; priority: number; isBreaking: boolean }[] = [];
    let highPriorityCount = 0;

    for (const item of items) {
      const coverage = getCoverageCount(item, items, clusterMap);
      const priority = computePriority(item, coverage);
      const isBreaking = priority >= PRIORITY_ALERT_THRESHOLD;

      if (isBreaking) highPriorityCount++;

      if (priority !== item.priority || isBreaking !== item.isBreaking) {
        diffs.push({ id: item.id, priority, isBreaking });
      }
    }

    if (diffs.length > 0) {
      await storage.bulkUpdatePriorities(diffs);
    }

    const decayed = await storage.decayStalePriorities(72);

    console.log(
      `[Priority] Scored ${items.length} items, ${diffs.length} updated, ${highPriorityCount} high-priority, ${decayed} decayed`,
    );
  } finally {
    isRecomputing = false;
  }
}
