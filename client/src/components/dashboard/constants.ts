import type { FeedItem } from "@shared/schema";
import {
  Radio, Activity, Brain, Zap, Shield, DollarSign, Package, Cpu,
} from "lucide-react";
import { SiOpenai, SiMeta, SiGoogle, SiNvidia } from "react-icons/si";

// ─── Types ───────────────────────────────────────────────────────

export type FeedItemWithBookmark = FeedItem & {
  isBookmarked: boolean;
  coverageCount?: number;
};
export type Stats = {
  total: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  breakingCount: number;
  unreadCount: number;
  lastRefreshed?: string;
};
export type Category =
  | "all"
  | "model_release"
  | "research"
  | "funding"
  | "product"
  | "policy"
  | "infrastructure";

export type SectionFilter = "all" | "ai" | "csp" | "quantum";

export const SECTION_FILTERS: {
  value: SectionFilter;
  label: string;
}[] = [
  { value: "all", label: "ALL" },
  { value: "ai", label: "AI" },
  { value: "csp", label: "CSP" },
  { value: "quantum", label: "QUANTUM" },
];

// ─── Constants ───────────────────────────────────────────────────

export const CATEGORIES: {
  value: Category;
  label: string;
  shortLabel: string;
  icon: any;
  color: string;
}[] = [
  { value: "all", label: "ALL FEEDS", shortLabel: "ALL", icon: Radio, color: "hsl(68, 95%, 60%)" },
  { value: "model_release", label: "MODEL RELEASES", shortLabel: "MODELS", icon: Brain, color: "hsl(68, 95%, 60%)" },
  { value: "research", label: "RESEARCH", shortLabel: "RESEARCH", icon: Activity, color: "hsl(270, 65%, 70%)" },
  { value: "product", label: "PRODUCTS", shortLabel: "PRODUCTS", icon: Package, color: "hsl(200, 85%, 62%)" },
  { value: "infrastructure", label: "INFRASTRUCTURE", shortLabel: "INFRA", icon: Cpu, color: "hsl(150, 60%, 55%)" },
  { value: "funding", label: "FUNDING", shortLabel: "FUNDING", icon: DollarSign, color: "hsl(38, 95%, 60%)" },
  { value: "policy", label: "POLICY", shortLabel: "POLICY", icon: Shield, color: "hsl(5, 80%, 62%)" },
];

export const CATEGORY_COLORS: Record<string, string> = {
  model_release: "hsl(68, 95%, 60%)",
  research: "hsl(270, 65%, 70%)",
  funding: "hsl(38, 95%, 60%)",
  product: "hsl(200, 85%, 62%)",
  policy: "hsl(5, 80%, 62%)",
  infrastructure: "hsl(150, 60%, 55%)",
};

export const SOURCE_META: Record<string, { icon: any; color: string; label: string }> = {
  openai: { icon: SiOpenai, color: "#10a37f", label: "OpenAI" },
  anthropic: { icon: Brain, color: "#d4a574", label: "Anthropic" },
  google_ai: { icon: SiGoogle, color: "#4285f4", label: "Google AI" },
  meta_ai: { icon: SiMeta, color: "#0668E1", label: "Meta AI" },
  xai: { icon: Zap, color: "#ffffff", label: "xAI" },
  mistral: { icon: Brain, color: "#ff7000", label: "Mistral" },
  nvidia: { icon: SiNvidia, color: "#76b900", label: "NVIDIA" },
  stability: { icon: Brain, color: "#a855f7", label: "Stability" },
  cohere: { icon: Brain, color: "#39ffc7", label: "Cohere" },
  huggingface: { icon: Brain, color: "#ffd21e", label: "HuggingFace" },
  community: { icon: Radio, color: "hsl(68, 95%, 60%)", label: "Community" },
  arxiv_ai: { icon: Activity, color: "#b31b1b", label: "arXiv AI" },
  arxiv_ml: { icon: Activity, color: "#b31b1b", label: "arXiv ML" },
  arxiv_nlp: { icon: Activity, color: "#b31b1b", label: "arXiv NLP" },
  techcrunch: { icon: Radio, color: "#00d100", label: "TechCrunch" },
  theverge: { icon: Radio, color: "#e33f81", label: "The Verge" },
  venturebeat: { icon: Radio, color: "#2196f3", label: "VentureBeat" },
  the_decoder: { icon: Radio, color: "#00bcd4", label: "The Decoder" },
  marktechpost: { icon: Radio, color: "#ff5722", label: "MarkTechPost" },
  anthropic_gh: { icon: Brain, color: "#d4a574", label: "Anthropic SDK" },
  openai_gh: { icon: SiOpenai, color: "#10a37f", label: "OpenAI SDK" },
  meta_gh: { icon: SiMeta, color: "#0668E1", label: "Llama Models" },
  hf_transformers: { icon: Brain, color: "#ffd21e", label: "HF Transformers" },
  mistral_gh: { icon: Brain, color: "#ff7000", label: "Mistral Inference" },
  google_gh: { icon: SiGoogle, color: "#4285f4", label: "Gemma" },
  simonwillison: { icon: Radio, color: "#2dd4bf", label: "Simon Willison" },
};
