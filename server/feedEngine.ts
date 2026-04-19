import RssParser from "rss-parser";
import { storage } from "./storage";
import { clusterRecentItems } from "./clustering";
import { recomputePriorities } from "./priority";
import { recordSuccess, recordFailure } from "./feedHealth";
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

async function fetchFeed(source: FeedSource): Promise<InsertFeedItem[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const items: InsertFeedItem[] = [];

    for (const entry of (feed.items || []).slice(0, 20)) {
      const title = entry.title || "Untitled";
      const description = entry.contentSnippet || entry.content || entry.summary || null;
      const truncatedDesc = description ? description.substring(0, 500) : null;
      const publishedAt = entry.pubDate || entry.isoDate || new Date().toISOString();
      const guid = entry.guid || entry.link || `${source.source}-${title}-${publishedAt}`;
      const category = categorizeItem(title, truncatedDesc, source.defaultCategory);

      items.push({
        title,
        description: truncatedDesc,
        url: entry.link || null,
        source: source.source,
        sourceLabel: source.sourceLabel,
        category,
        publishedAt: new Date(publishedAt).toISOString(),
        fetchedAt: new Date().toISOString(),
        guid,
        isBreaking: isBreakingNews(title, truncatedDesc, publishedAt),
        imageUrl: entry.enclosure?.url || null,
      });
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

  // Cluster recent items, then recompute priorities
  if (newItemCount > 0) {
    try {
      await clusterRecentItems();
      await recomputePriorities();
    } catch (err) {
      console.error("[FeedEngine] Post-fetch processing failed:", (err as Error).message);
    }
  }

  return { newItemCount, newItemIds };
}

// Seed with synthetic data if DB is empty for demo purposes
export async function seedDemoData(): Promise<void> {
  const stats = await storage.getStats();
  if (stats.total > 0) return;

  console.log("[FeedEngine] Seeding demo data...");

  const now = new Date();
  const demoItems: InsertFeedItem[] = [
    // OpenAI
    {
      title: "GPT-5 Turbo: 2x Faster Inference with Improved Reasoning",
      description: "OpenAI announces GPT-5 Turbo with dramatically reduced latency, improved chain-of-thought reasoning, and native multimodal capabilities. Available today via API.",
      url: "https://openai.com/blog",
      source: "openai",
      sourceLabel: "OpenAI",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-openai-gpt5-turbo",
      isBreaking: true,
      imageUrl: null,
    },
    {
      title: "Sora 2.0: Real-Time Video Generation at 4K Resolution",
      description: "OpenAI's video model now supports real-time generation, 4K output, and fine-grained style control. Enterprise API access rolling out this week.",
      url: "https://openai.com/blog",
      source: "openai",
      sourceLabel: "OpenAI",
      category: "product",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 3).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-openai-sora2",
      isBreaking: true,
      imageUrl: null,
    },
    {
      title: "OpenAI Codex Agent: Autonomous Software Engineering",
      description: "New Codex agent can handle multi-file refactors, write tests, and deploy to production with human approval gates. Currently in limited beta.",
      url: "https://openai.com/blog",
      source: "openai",
      sourceLabel: "OpenAI",
      category: "product",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 8).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-openai-codex-agent",
      isBreaking: false,
      imageUrl: null,
    },

    // Anthropic
    {
      title: "Claude 4 Opus: Extended Context Window to 1M Tokens",
      description: "Anthropic releases Claude 4 Opus with 1M token context window, improved tool use, and significantly reduced hallucination rates across all benchmarks.",
      url: "https://anthropic.com/news",
      source: "anthropic",
      sourceLabel: "Anthropic",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-anthropic-claude4-opus",
      isBreaking: true,
      imageUrl: null,
    },
    {
      title: "Constitutional AI v3: Self-Improving Safety Alignment",
      description: "New paper from Anthropic introduces Constitutional AI v3, demonstrating models that iteratively improve their own safety properties without human feedback.",
      url: "https://anthropic.com/research",
      source: "anthropic",
      sourceLabel: "Anthropic",
      category: "research",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 12).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-anthropic-cai-v3",
      isBreaking: false,
      imageUrl: null,
    },
    {
      title: "Anthropic Raises $5B Series D at $60B Valuation",
      description: "Anthropic closes its largest funding round led by Google and Spark Capital. Company plans to invest in compute infrastructure and research talent.",
      url: "https://anthropic.com/news",
      source: "anthropic",
      sourceLabel: "Anthropic",
      category: "funding",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-anthropic-series-d",
      isBreaking: false,
      imageUrl: null,
    },

    // Google DeepMind
    {
      title: "Gemini Ultra 2.0: Multi-Agent Orchestration Built-In",
      description: "Google DeepMind releases Gemini Ultra 2.0 with native multi-agent orchestration, enabling complex workflows across search, code, and data analysis in a single model.",
      url: "https://deepmind.google/blog",
      source: "google_ai",
      sourceLabel: "Google DeepMind",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-deepmind-gemini-ultra2",
      isBreaking: true,
      imageUrl: null,
    },
    {
      title: "AlphaFold 4: Protein-Drug Interaction Prediction",
      description: "DeepMind extends AlphaFold to predict protein-drug interactions with 95% accuracy, potentially accelerating drug discovery by years.",
      url: "https://deepmind.google/blog",
      source: "google_ai",
      sourceLabel: "Google DeepMind",
      category: "research",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 18).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-deepmind-alphafold4",
      isBreaking: false,
      imageUrl: null,
    },

    // Meta AI
    {
      title: "LLaMA 4 400B: Open-Source Frontier Model",
      description: "Meta releases LLaMA 4 with 400B parameters under an open license. Benchmarks competitive with proprietary models across reasoning, code, and multilingual tasks.",
      url: "https://ai.meta.com/blog",
      source: "meta_ai",
      sourceLabel: "Meta AI",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-meta-llama4",
      isBreaking: true,
      imageUrl: null,
    },
    {
      title: "Meta's New AI Chip: MTIA v3 for Inference at Scale",
      description: "Meta unveils third-generation custom silicon designed for inference workloads, claiming 3x efficiency over previous generation across recommendation and language models.",
      url: "https://ai.meta.com/blog",
      source: "meta_ai",
      sourceLabel: "Meta AI",
      category: "infrastructure",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 36).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-meta-mtia-v3",
      isBreaking: false,
      imageUrl: null,
    },

    // xAI
    {
      title: "Grok 3.5: Enhanced Real-Time Web Understanding",
      description: "xAI releases Grok 3.5 with improved real-time web browsing, fact verification, and multi-step reasoning. Integrated into X premium features.",
      url: "https://x.ai/blog",
      source: "xai",
      sourceLabel: "xAI",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 4).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-xai-grok35",
      isBreaking: false,
      imageUrl: null,
    },

    // Mistral AI
    {
      title: "Mistral Large 3: European Sovereign AI Model",
      description: "Mistral releases Large 3, a 175B parameter model trained exclusively on European data centers with full GDPR compliance. Competitive on multilingual benchmarks.",
      url: "https://mistral.ai/news",
      source: "mistral",
      sourceLabel: "Mistral AI",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 10).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-mistral-large3",
      isBreaking: false,
      imageUrl: null,
    },

    // Stability AI
    {
      title: "Stable Diffusion 4: Video and 3D Generation Unified",
      description: "Stability AI releases SD4 combining image, video, and 3D asset generation in a single model architecture. Open weights available on Hugging Face.",
      url: "https://stability.ai/news",
      source: "stability",
      sourceLabel: "Stability AI",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 15).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-stability-sd4",
      isBreaking: false,
      imageUrl: null,
    },

    // Infrastructure
    {
      title: "NVIDIA H200 Tensor Core GPU: 2x Memory Bandwidth",
      description: "NVIDIA announces H200 with 141GB HBM3e memory and 4.8TB/s bandwidth. Specifically optimized for large language model inference workloads.",
      url: "https://nvidia.com/blog",
      source: "nvidia",
      sourceLabel: "NVIDIA",
      category: "infrastructure",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 48).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-nvidia-h200",
      isBreaking: false,
      imageUrl: null,
    },
    {
      title: "FlashAttention-3: 50% Faster Transformer Training",
      description: "New paper introduces FlashAttention-3 with hardware-aware optimizations achieving 50% speedup on H100 GPUs. Already integrated into PyTorch nightly.",
      url: "https://arxiv.org",
      source: "arxiv_ml",
      sourceLabel: "arXiv ML",
      category: "infrastructure",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 20).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-flashattention3",
      isBreaking: false,
      imageUrl: null,
    },

    // Research
    {
      title: "Scaling Laws for Mixture of Experts: 10x Efficiency",
      description: "Researchers demonstrate new scaling laws specific to MoE architectures, showing that sparse models can achieve equivalent performance at 10x lower compute cost.",
      url: "https://arxiv.org",
      source: "arxiv_ml",
      sourceLabel: "arXiv ML",
      category: "research",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 14).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-moe-scaling-laws",
      isBreaking: false,
      imageUrl: null,
    },
    {
      title: "Test-Time Compute: Why Thinking Longer Beats Bigger Models",
      description: "New research shows that allocating more compute at inference time (chain-of-thought, beam search, verification) often outperforms simply scaling model parameters.",
      url: "https://arxiv.org",
      source: "arxiv_ai",
      sourceLabel: "arXiv AI",
      category: "research",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 22).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-test-time-compute",
      isBreaking: false,
      imageUrl: null,
    },

    // Policy
    {
      title: "EU AI Act: First Compliance Deadline Approaches",
      description: "Companies operating AI systems in the EU face their first compliance checkpoint. General-purpose AI providers must register and submit transparency reports.",
      url: "https://techcrunch.com",
      source: "techcrunch",
      sourceLabel: "TechCrunch AI",
      category: "policy",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 30).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-eu-ai-act-deadline",
      isBreaking: false,
      imageUrl: null,
    },

    // Individuals / Community
    {
      title: "Boris Cherny: Building Reliable AI Agents with Type-Safe Tool Calling",
      description: "Boris Cherny publishes a comprehensive guide on using TypeScript type systems to enforce correctness in AI agent tool calling patterns.",
      url: "https://twitter.com/borischerny",
      source: "community",
      sourceLabel: "AI Community",
      category: "product",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 7).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-boris-cherny-agents",
      isBreaking: false,
      imageUrl: null,
    },
    {
      title: "Hugging Face: SmolLM 3 Beats GPT-3.5 at 1.7B Parameters",
      description: "Hugging Face releases SmolLM 3, a family of small language models that outperform GPT-3.5 Turbo on several benchmarks while running on consumer hardware.",
      url: "https://huggingface.co/blog",
      source: "huggingface",
      sourceLabel: "Hugging Face",
      category: "model_release",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 9).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-hf-smollm3",
      isBreaking: false,
      imageUrl: null,
    },
    {
      title: "Cohere Command R+: Enterprise RAG Performance Leader",
      description: "Cohere announces Command R+ optimized for retrieval-augmented generation, claiming state-of-the-art on enterprise knowledge retrieval benchmarks.",
      url: "https://cohere.com/blog",
      source: "cohere",
      sourceLabel: "Cohere",
      category: "product",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 16).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-cohere-command-r-plus",
      isBreaking: false,
      imageUrl: null,
    },
    {
      title: "1-Bit LLMs: Microsoft Proves Ternary Weights Match Full Precision",
      description: "Microsoft Research demonstrates that models using only {-1, 0, 1} weights can match full-precision performance, enabling 10x cheaper inference on commodity hardware.",
      url: "https://arxiv.org",
      source: "arxiv_ml",
      sourceLabel: "arXiv ML",
      category: "infrastructure",
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 25).toISOString(),
      fetchedAt: now.toISOString(),
      guid: "demo-1bit-llms",
      isBreaking: false,
      imageUrl: null,
    },
  ];

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
