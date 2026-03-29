import type { FeedItem } from "@shared/schema";
import { storage } from "./storage";
import { similarity } from "./clustering";

// Source authority weights (0-100)
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

// Category relevance weights
const CATEGORY_WEIGHT: Record<string, number> = {
  model_release: 15,
  research: 12,
  infrastructure: 10,
  product: 8,
  funding: 7,
  policy: 6,
};

// High-value keywords for intensity scoring
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

  // Cross-source coverage (30 points max)
  score += Math.min(coverageCount * 10, 30);

  // Source authority (20 points max)
  const authority = SOURCE_AUTHORITY[item.source] ?? 50;
  score += (authority / 100) * 20;

  // Keyword intensity (20 points max)
  const text = `${item.title} ${item.description || ""}`.toLowerCase();
  const matches = HIGH_VALUE_KEYWORDS.filter((kw) => text.includes(kw)).length;
  score += Math.min(matches * 5, 20);

  // Recency (15 points max)
  const hoursAgo =
    (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 1) score += 15;
  else if (hoursAgo < 6) score += 12;
  else if (hoursAgo < 24) score += 8;
  else if (hoursAgo < 48) score += 4;

  // Category relevance (15 points max)
  score += CATEGORY_WEIGHT[item.category] ?? 5;

  return Math.round(Math.min(score, 100));
}

/**
 * Compute coverage count using cluster or title similarity.
 * If item has a clusterId, count items sharing it.
 * Otherwise fall back to title-similarity check.
 */
function getCoverageCount(item: FeedItem, allRecent: FeedItem[]): number {
  if (item.clusterId) {
    return allRecent.filter((i) => i.clusterId === item.clusterId).length;
  }
  // Fallback: count items from different sources with similar titles
  let count = 1;
  for (const other of allRecent) {
    if (other.id === item.id) continue;
    if (other.source === item.source) continue;
    if (similarity(item.title, other.title) > 0.35) count++;
  }
  return count;
}

/** Recompute priorities for all items in the last 72 hours */
export async function recomputePriorities(): Promise<void> {
  const items = await storage.getRecentItems(72);
  if (items.length === 0) return;

  let highPriorityCount = 0;

  for (const item of items) {
    const coverage = getCoverageCount(item, items);
    const priority = computePriority(item, coverage);
    const isBreaking = priority >= 80;

    await storage.updatePriority(item.id, priority);
    await storage.updateIsBreaking(item.id, isBreaking);

    if (isBreaking) highPriorityCount++;
  }

  console.log(
    `[Priority] Scored ${items.length} items, ${highPriorityCount} high-priority`,
  );
}
