import RssParser from "rss-parser";
import { storage } from "./storage";
import { clusterRecentItems } from "./clustering";
import { recomputePriorities } from "./priority";
import { recordSuccess, recordFailure } from "./feedHealth";
import { buildDemoItems } from "./demoData";
import type { InsertFeedItem } from "@shared/schema";

const parser = new RssParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'AI-Ops-Center/1.0',
  },
});

// RSS/Atom feed sources for the AI ecosystem
interface FeedSource {
  url: string;
  source: string;
  sourceLabel: string;
  defaultCategory: string;
}

const FEED_SOURCES: FeedSource[] = [
  // Major AI Labs - Blogs
  { url: "https://openai.com/blog/rss/", source: "openai", sourceLabel: "OpenAI", defaultCategory: "model_release" },
  { url: "https://www.anthropic.com/feed.xml", source: "anthropic", sourceLabel: "Anthropic", defaultCategory: "research" },
  { url: "https://blog.google/technology/ai/rss/", source: "google_ai", sourceLabel: "Google AI", defaultCategory: "product" },
  { url: "https://about.fb.com/news/category/ai-ml/feed/", source: "meta_ai", sourceLabel: "Meta AI", defaultCategory: "research" },
  { url: "https://mistral.ai/feed.xml", source: "mistral", sourceLabel: "Mistral AI", defaultCategory: "model_release" },

  // Research & News Aggregators
  { url: "https://arxiv.org/rss/cs.AI", source: "arxiv_ai", sourceLabel: "arXiv AI", defaultCategory: "research" },
  { url: "https://arxiv.org/rss/cs.CL", source: "arxiv_nlp", sourceLabel: "arXiv NLP", defaultCategory: "research" },
  { url: "https://arxiv.org/rss/cs.LG", source: "arxiv_ml", sourceLabel: "arXiv ML", defaultCategory: "research" },

  // Tech news covering AI
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "techcrunch", sourceLabel: "TechCrunch AI", defaultCategory: "product" },
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "theverge", sourceLabel: "The Verge AI", defaultCategory: "product" },
  { url: "https://venturebeat.com/category/ai/feed/", source: "venturebeat", sourceLabel: "VentureBeat AI", defaultCategory: "product" },

  // AI-specific publications
  { url: "https://the-decoder.com/feed/", source: "the_decoder", sourceLabel: "The Decoder", defaultCategory: "product" },
  { url: "https://www.marktechpost.com/feed/", source: "marktechpost", sourceLabel: "MarkTechPost", defaultCategory: "research" },

  // Hugging Face blog
  { url: "https://huggingface.co/blog/feed.xml", source: "huggingface", sourceLabel: "Hugging Face", defaultCategory: "model_release" },

  // GitHub Release Feeds — track SDK & tool releases from key AI orgs
  { url: "https://github.com/anthropics/anthropic-sdk-python/releases.atom", source: "anthropic_gh", sourceLabel: "Anthropic SDK", defaultCategory: "product" },
  { url: "https://github.com/anthropics/claude-code/releases.atom", source: "anthropic_gh", sourceLabel: "Claude Code", defaultCategory: "product" },
  { url: "https://github.com/anthropics/anthropic-sdk-typescript/releases.atom", source: "anthropic_gh", sourceLabel: "Anthropic TS SDK", defaultCategory: "product" },
  { url: "https://github.com/openai/openai-python/releases.atom", source: "openai_gh", sourceLabel: "OpenAI SDK", defaultCategory: "product" },
  { url: "https://github.com/meta-llama/llama-models/releases.atom", source: "meta_gh", sourceLabel: "Llama Models", defaultCategory: "model_release" },
  { url: "https://github.com/huggingface/transformers/releases.atom", source: "hf_transformers", sourceLabel: "HF Transformers", defaultCategory: "product" },
  { url: "https://github.com/mistralai/mistral-inference/releases.atom", source: "mistral_gh", sourceLabel: "Mistral Inference", defaultCategory: "product" },
  { url: "https://github.com/google-deepmind/gemma/releases.atom", source: "google_gh", sourceLabel: "Gemma", defaultCategory: "model_release" },

  // Individual AI voices & analysts
  { url: "https://simonwillison.net/atom/everything/", source: "simonwillison", sourceLabel: "Simon Willison", defaultCategory: "product" },
];

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

export async function fetchAllFeeds(): Promise<{ newItemCount: number; newItemIds: number[] }> {
  console.log(`[FeedEngine] Fetching ${FEED_SOURCES.length} feeds...`);
  let newItemCount = 0;
  const newItemIds: number[] = [];

  const results = await Promise.allSettled(
    FEED_SOURCES.map(source => fetchFeed(source))
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

  // Always cluster + recompute (both diff-only and re-entrance-guarded);
  // running on quiet cycles is what guarantees stale priorities decay.
  try {
    await clusterRecentItems();
    await recomputePriorities();
  } catch (err) {
    console.error("[FeedEngine] Post-fetch processing failed:", (err as Error).message);
  }

  return { newItemCount, newItemIds };
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
