import RssParser from "rss-parser";
import { storage } from "./storage";
import { clusterRecentItems } from "./clustering";
import { recomputePriorities } from "./priority";
import { recordSuccess, recordFailure } from "./feedHealth";
import { buildDemoItems } from "./demoData";
import { embedMany, isEmbeddingsEnabled } from "./embeddings";
import { evaluateWatchlists, getWatchlistEmbeddings } from "./watchlistMatcher";
import type { FeedItem, InsertFeedItem } from "@shared/schema";

/** A watchlist alert: the watchlist that matched plus the items that hit it. */
export interface WatchlistHit {
  watchlistId: number;
  name: string;
  items: { id: number; title: string; sourceLabel: string }[];
}

export interface FetchResult {
  newItemCount: number;
  newItemIds: number[];
  watchlistHits: WatchlistHit[];
}

// Cap the per-cycle self-healing backfill so a long NULL backlog never blocks
// a fetch cycle; the dedicated backfill script drains the rest.
const BACKFILL_SWEEP_LIMIT = 25;

/** Build the text Titan embeds for an item: "title: description". */
function embedInput(item: { title: string; description: string | null }): string {
  return item.title + (item.description ? ": " + item.description : "");
}

/**
 * Embed the given items and persist their vectors. Failures leave embedding
 * NULL so the next sweep retries; never throws.
 */
async function embedAndPersist(items: FeedItem[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const vectors = await embedMany(items.map(embedInput));
    const updates: { id: number; embedding: number[] }[] = [];
    for (let i = 0; i < items.length; i++) {
      const vec = vectors[i];
      if (vec) updates.push({ id: items[i].id, embedding: vec });
    }
    if (updates.length > 0) await storage.updateEmbeddings(updates);
  } catch (err) {
    console.error("[FeedEngine] Embedding persist failed:", (err as Error).message);
  }
}

const parser = new RssParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'AI-Ops-Center/1.0',
  },
});

// Per-cycle fetch shape, mapped from the sources table (slug -> source).
interface FeedSource {
  url: string;
  source: string;
  sourceLabel: string;
  defaultCategory: string;
}

// Keywords that help categorize items beyond default
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  model_release: ["release", "launch", "model", "gpt", "claude", "gemini", "llama", "mistral", "announcing", "new model", "parameter", "benchmark", "weights", "open source", "fine-tune"],
  research: ["paper", "research", "study", "arxiv", "findings", "breakthrough", "novel", "method", "algorithm", "training", "RLHF", "alignment", "scaling law"],
  funding: ["funding", "raise", "investment", "valuation", "series", "billion", "million", "ipo", "acquisition", "acquire"],
  product: ["product", "feature", "update", "api", "sdk", "integration", "plugin", "app", "tool", "platform", "service", "chatbot", "assistant"],
  policy: ["regulation", "policy", "safety", "governance", "ethics", "ban", "law", "congress", "eu", "executive order", "guidelines", "compliance"],
  infrastructure: ["gpu", "tpu", "chip", "nvidia", "amd", "compute", "data center", "inference", "latency", "memory", "optimization", "quantization", "distillation", "hardware", "accelerator"],
};

function categorizeItem(title: string, description: string | null, defaultCategory: string): string {
  const text = `${title} ${description || ""}`.toLowerCase();
  let bestCategory = defaultCategory;
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

function isBreakingNews(title: string, description: string | null, publishedAt: string): boolean {
  const text = `${title} ${description || ""}`.toLowerCase();

  // Only consider items from last 48 hours as potentially breaking
  const hoursSince = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSince > 48) return false;

  // Tier 1: High-confidence keywords (single match sufficient)
  const highSignal = [
    "breaking:", "just announced", "available now", "available today",
    "gpt-5", "gpt-6", "claude 4", "claude 5", "gemini 2", "gemini 3",
    "llama 4", "llama 5", "agi", "superintelligence"
  ];
  if (highSignal.some(kw => text.includes(kw))) return true;

  // Tier 2: Medium-confidence (need 2+ matches for breaking)
  const mediumSignal = [
    "new model", "state-of-the-art", "world record", "surpasses",
    "billion parameter", "open source release", "launches today",
    "announcing", "breakthrough"
  ];
  return mediumSignal.filter(kw => text.includes(kw)).length >= 2;
}

interface FeedEntry {
  title?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  pubDate?: string;
  isoDate?: string;
  guid?: string;
  link?: string;
  enclosure?: { url?: string };
}

/** Some feeds (notably GitHub release atom) carry raw HTML in content/summary. */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntry(
  entry: FeedEntry,
  source: Pick<FeedSource, "source" | "sourceLabel" | "defaultCategory">,
  nowISO: string,
): InsertFeedItem | null {
  const title = stripHtml(entry.title || "") || "Untitled";
  const rawDescription = entry.contentSnippet || entry.content || entry.summary || null;
  const description = rawDescription ? stripHtml(rawDescription) || null : null;
  const truncatedDesc = description ? description.substring(0, 500) : null;
  const ts = Date.parse(entry.pubDate || entry.isoDate || "");
  const publishedAt = Number.isNaN(ts) ? nowISO : new Date(ts).toISOString();
  const guid = entry.guid || entry.link || `${source.source}-${title}-${publishedAt}`;
  const category = categorizeItem(title, truncatedDesc, source.defaultCategory);

  return {
    title,
    description: truncatedDesc,
    url: entry.link || null,
    source: source.source,
    sourceLabel: source.sourceLabel,
    category,
    publishedAt,
    fetchedAt: nowISO,
    guid,
    isBreaking: isBreakingNews(title, truncatedDesc, publishedAt),
    imageUrl: entry.enclosure?.url || null,
  };
}

async function fetchFeed(source: FeedSource): Promise<InsertFeedItem[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const items: InsertFeedItem[] = [];

    for (const entry of (feed.items || []).slice(0, 20)) {
      try {
        const item = normalizeEntry(entry, source, new Date().toISOString());
        if (item) items.push(item);
      } catch (err) {
        console.warn(
          `[FeedEngine] Skipping bad entry from ${source.sourceLabel} ("${entry.title || "untitled"}"):`,
          (err as Error).message,
        );
      }
    }

    recordSuccess(source.source);
    return items;
  } catch (error) {
    recordFailure(source.source, (error as Error).message);
    console.error(`Failed to fetch feed from ${source.sourceLabel}:`, (error as Error).message);
    return [];
  }
}

/**
 * Evaluate alert-enabled watchlists against the just-ingested items, stamping
 * lastTriggeredAt on every watchlist that hit. Re-reads the items so semantic
 * matching sees freshly persisted embeddings. Never throws — returns [] on any
 * failure so a watchlist problem can't break the fetch cycle.
 */
async function evaluateWatchlistAlerts(newItemIds: number[]): Promise<WatchlistHit[]> {
  if (newItemIds.length === 0) return [];
  try {
    const watchlists = (await storage.getWatchlists()).filter((wl) => wl.alert);
    if (watchlists.length === 0) return [];

    const items = await storage.getItemsByIds(newItemIds);
    const embeddingsByWatchlistId = isEmbeddingsEnabled()
      ? await getWatchlistEmbeddings(watchlists)
      : new Map<number, number[]>();
    const hitMap = evaluateWatchlists(items, watchlists, embeddingsByWatchlistId);

    const stampedAt = new Date().toISOString();
    const hits: WatchlistHit[] = [];
    for (const wl of watchlists) {
      const matched = hitMap.get(wl.id);
      if (!matched || matched.length === 0) continue;
      await storage.updateWatchlist(wl.id, { lastTriggeredAt: stampedAt });
      hits.push({
        watchlistId: wl.id,
        name: wl.name,
        items: matched.map((i) => ({
          id: i.id,
          title: i.title,
          sourceLabel: i.sourceLabel,
        })),
      });
    }
    return hits;
  } catch (err) {
    console.error("[FeedEngine] Watchlist evaluation failed:", (err as Error).message);
    return [];
  }
}

export async function fetchAllFeeds(): Promise<FetchResult> {
  const enabledSources = await storage.getSources(true);
  const feedSources: FeedSource[] = enabledSources.map((s) => ({
    url: s.url,
    source: s.slug,
    sourceLabel: s.label,
    defaultCategory: s.defaultCategory,
  }));

  console.log(`[FeedEngine] Fetching ${feedSources.length} feeds...`);
  let newItemCount = 0;
  const newItemIds: number[] = [];

  const results = await Promise.allSettled(
    feedSources.map(source => fetchFeed(source))
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const item of result.value) {
        try {
          const exists = await storage.feedItemExists(item.guid);
          if (!exists) {
            const created = await storage.createFeedItem(item);
            newItemCount++;
            newItemIds.push(created.id);
          }
        } catch (err) {
          // Duplicate guid, skip
        }
      }
    }
  }

  console.log(`[FeedEngine] Fetched ${newItemCount} new items`);

  // Embed new items, then sweep up to BACKFILL_SWEEP_LIMIT stragglers whose
  // prior embed failed — this runs before clustering so cosine clustering sees
  // fresh vectors. Disabled wholesale via EMBEDDINGS_ENABLED=false.
  if (isEmbeddingsEnabled()) {
    try {
      if (newItemIds.length > 0) {
        const newItems = await storage.getItemsByIds(newItemIds);
        await embedAndPersist(newItems);
      }
      const stragglers = await storage.getItemsMissingEmbeddings(BACKFILL_SWEEP_LIMIT);
      await embedAndPersist(stragglers);
    } catch (err) {
      console.error("[FeedEngine] Embedding sweep failed:", (err as Error).message);
    }
  }

  // Always cluster + recompute (both diff-only and re-entrance-guarded);
  // running on quiet cycles is what guarantees stale priorities decay.
  try {
    await clusterRecentItems();
    await recomputePriorities();
  } catch (err) {
    console.error("[FeedEngine] Post-fetch processing failed:", (err as Error).message);
  }

  // Alert on watchlist hits against only the new items (after embeddings land
  // so semantic watchlists can match on vectors).
  const watchlistHits = await evaluateWatchlistAlerts(newItemIds);

  return { newItemCount, newItemIds, watchlistHits };
}

/**
 * Live probe for user-submitted feed URLs. Shares the engine's parser (and its
 * 10s timeout); throws with the parse error so callers can surface it.
 */
export async function probeFeedUrl(
  url: string,
): Promise<{ feedTitle: string; itemCount: number }> {
  const feed = await parser.parseURL(url);
  const feedTitle = (feed.title || "").trim();
  const itemCount = (feed.items || []).length;
  if (!feedTitle) throw new Error("Feed parsed but has no title");
  if (itemCount < 1) throw new Error("Feed parsed but contains no entries");
  return { feedTitle, itemCount };
}

// Seed synthetic data for local development demos only
export async function seedDemoData(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.log("[FeedEngine] Demo seed skipped: never seeds in production");
    return;
  }
  if (process.env.SEED_DEMO_DATA !== "true") {
    console.log('[FeedEngine] Demo seed skipped: SEED_DEMO_DATA is not "true"');
    return;
  }
  const stats = await storage.getStats();
  if (stats.total > 0) {
    console.log("[FeedEngine] Demo seed skipped: feed_items table is not empty");
    return;
  }

  console.log("[FeedEngine] Seeding demo data...");

  const demoItems = buildDemoItems(new Date());

  for (const item of demoItems) {
    try {
      await storage.createFeedItem(item);
    } catch (err) {
      // Skip duplicates
    }
  }

  console.log(`[FeedEngine] Seeded ${demoItems.length} demo items`);
}

// Exposed for unit tests only — keep prefix so intent is explicit.
export const __testing__categorizeItem = categorizeItem;
export const __testing__isBreakingNews = isBreakingNews;
export const __testing__normalizeEntry = normalizeEntry;
