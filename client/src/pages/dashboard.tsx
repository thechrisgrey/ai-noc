import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import type { FeedItem } from "@shared/schema";
import {
  Search, RefreshCw, Bookmark, BookmarkCheck, ExternalLink,
  Cpu, Brain, Zap, Shield, DollarSign, Package,
  Radio, Activity, AlertTriangle, Clock, Filter, X,
  TrendingUp, ArrowUpDown, Bell, BellOff,
  ChevronDown, ChevronUp,
} from "lucide-react";
import * as notifications from "@/lib/notifications";
import { SiOpenai, SiMeta, SiGoogle, SiNvidia } from "react-icons/si";

// ─── Types ───────────────────────────────────────────────────────

type FeedItemWithBookmark = FeedItem & { isBookmarked: boolean };
type Stats = {
  total: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  breakingCount: number;
  lastRefreshed?: string;
};
type Category =
  | "all"
  | "model_release"
  | "research"
  | "funding"
  | "product"
  | "policy"
  | "infrastructure";

// ─── Constants ───────────────────────────────────────────────────

const CATEGORIES: {
  value: Category;
  label: string;
  shortLabel: string;
  icon: any;
  color: string;
}[] = [
  { value: "all", label: "ALL FEEDS", shortLabel: "ALL", icon: Radio, color: "hsl(175,85%,50%)" },
  { value: "model_release", label: "MODEL RELEASES", shortLabel: "MODELS", icon: Brain, color: "hsl(175,85%,50%)" },
  { value: "research", label: "RESEARCH", shortLabel: "RESEARCH", icon: Activity, color: "hsl(280,70%,65%)" },
  { value: "product", label: "PRODUCTS", shortLabel: "PRODUCTS", icon: Package, color: "hsl(200,80%,55%)" },
  { value: "infrastructure", label: "INFRASTRUCTURE", shortLabel: "INFRA", icon: Cpu, color: "hsl(140,60%,50%)" },
  { value: "funding", label: "FUNDING", shortLabel: "FUNDING", icon: DollarSign, color: "hsl(45,90%,60%)" },
  { value: "policy", label: "POLICY", shortLabel: "POLICY", icon: Shield, color: "hsl(0,70%,60%)" },
];

const CATEGORY_COLORS: Record<string, string> = {
  model_release: "hsl(175,85%,50%)",
  research: "hsl(280,70%,65%)",
  funding: "hsl(45,90%,60%)",
  product: "hsl(200,80%,55%)",
  policy: "hsl(0,70%,60%)",
  infrastructure: "hsl(140,60%,50%)",
};

const SOURCE_META: Record<string, { icon: any; color: string; label: string }> = {
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
  community: { icon: Radio, color: "#00c8b4", label: "Community" },
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

// ─── Utilities ───────────────────────────────────────────────────

function getSourceMeta(source: string) {
  return SOURCE_META[source] || { icon: Radio, color: "#00c8b4", label: source };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function getTimeGroup(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  if (date.toDateString() === now.toDateString()) return "TODAY";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "YESTERDAY";
  const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 7) return "THIS WEEK";
  return "EARLIER";
}

function extractTrending(
  items: FeedItemWithBookmark[],
): { word: string; count: number }[] {
  const stop = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","from","is","it","that","this","are","was","be","has","had","have",
    "will","can","do","does","did","not","no","so","if","its","how","new",
    "vs","than","more","most","all","into","out","up","about","what","which",
    "their","our","your","you","we","they","been","being","get","got","use",
    "used","using","one","two","may","also","just","over","per","why","top",
    "best","key","big","now","could","like","based","first","make","way",
    "says","said","show","shows","here","after","before","between","through",
  ]);
  const counts: Record<string, number> = {};
  for (const item of items) {
    const words = item.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));
    const seen = new Set<string>();
    for (const w of words) {
      if (!seen.has(w)) {
        counts[w] = (counts[w] || 0) + 1;
        seen.add(w);
      }
    }
  }
  return Object.entries(counts)
    .map(([word, count]) => ({ word, count }))
    .filter(({ count }) => count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

// ─── Sub-components ──────────────────────────────────────────────

function StatusBar({ lastSynced }: { lastSynced?: string }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="hidden md:flex items-center gap-3 text-xs data-readout text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 status-pulse" />
        <span className="text-green-400">ONLINE</span>
      </span>
      <span className="text-border">|</span>
      <span>{time.toLocaleTimeString("en-US", { hour12: false })}</span>
      <span className="text-border">|</span>
      <span>
        UTC
        {time.getTimezoneOffset() > 0 ? "-" : "+"}
        {Math.abs(time.getTimezoneOffset() / 60)}
      </span>
      {lastSynced && (
        <>
          <span className="text-border">|</span>
          <span className="text-muted-foreground/50">
            SYNCED {timeAgo(lastSynced)}
          </span>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: any;
  color: string;
}) {
  return (
    <div className="relative px-4 py-3 rounded border border-border/40 bg-card/30 overflow-hidden">
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px]"
        style={{ backgroundColor: color, opacity: 0.5 }}
      />
      <div className="flex items-center gap-3">
        <div style={{ color }} className="opacity-60">
          <Icon size={18} />
        </div>
        <div>
          <div className="data-readout text-lg font-semibold text-foreground">
            {value}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedCard({
  item,
  onToggleBookmark,
}: {
  item: FeedItemWithBookmark;
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
}) {
  const sourceInfo = getSourceMeta(item.source);
  const SourceIcon = sourceInfo.icon;
  const catColor = CATEGORY_COLORS[item.category] || "hsl(175,85%,50%)";
  const pri = (item as any).priority as number || 0;
  const isHigh = pri >= 80;
  const isMedium = pri >= 60 && pri < 80;

  return (
    <div
      className={`group relative rounded transition-all duration-200 hover:bg-card/60 ${
        isHigh
          ? "border border-red-500/25 bg-red-950/15 pulse-breaking border-l-[3px] border-l-red-500"
          : isMedium
            ? "border border-amber-500/20 bg-amber-950/10 border-l-[3px] border-l-amber-500"
            : "border border-border/30 bg-card/20 border-l-[3px]"
      }`}
      style={isHigh || isMedium ? undefined : { borderLeftColor: catColor }}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Source icon */}
        <div
          className="mt-0.5 flex-shrink-0 w-7 h-7 rounded flex items-center justify-center"
          style={{ backgroundColor: `${sourceInfo.color}12` }}
        >
          <SourceIcon size={14} style={{ color: sourceInfo.color }} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-[11px] font-medium"
              style={{ color: sourceInfo.color }}
            >
              {item.sourceLabel}
            </span>
            <span
              className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-px rounded"
              style={{
                color: catColor,
                backgroundColor: catColor
                  .replace("hsl(", "hsla(")
                  .replace(")", ",0.1)"),
              }}
            >
              {item.category.replace("_", " ")}
            </span>
            {isHigh && (
              <span className="flex items-center gap-0.5 text-[9px] text-red-400 font-bold uppercase tracking-wider">
                <AlertTriangle size={9} />
                HIGH PRIORITY
              </span>
            )}
            {isMedium && (
              <span className="text-[9px] text-amber-400/80 font-semibold uppercase tracking-wider">
                NOTABLE
              </span>
            )}
            {pri > 0 && (
              <span className="text-[8px] data-readout text-muted-foreground/30 px-1 py-px rounded bg-card/50">
                P{pri}
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground/50 data-readout flex items-center gap-1 flex-shrink-0">
              <Clock size={9} />
              {timeAgo(item.publishedAt)}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-[13px] font-medium text-foreground/90 leading-snug mb-1">
            {item.title}
          </h3>

          {/* Description preview - always visible */}
          {item.description && (
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {/* Actions - always visible */}
        <div className="flex items-center gap-0.5 flex-shrink-0 mt-1">
          <button
            onClick={() => onToggleBookmark(item.id, item.isBookmarked)}
            className={`p-1.5 rounded transition-colors ${
              item.isBookmarked
                ? "text-amber-400 hover:text-amber-300"
                : "text-muted-foreground/30 hover:text-amber-400"
            }`}
            aria-label={item.isBookmarked ? "Remove bookmark" : "Bookmark"}
          >
            {item.isBookmarked ? (
              <BookmarkCheck size={14} />
            ) : (
              <Bookmark size={14} />
            )}
          </button>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded text-muted-foreground/30 hover:text-primary transition-colors"
              aria-label="Open article"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Right Panel Components ──────────────────────────────────────

function CategoryDistribution({ stats }: { stats?: Stats }) {
  const cats = CATEGORIES.filter((c) => c.value !== "all");
  const maxCount = Math.max(
    ...cats.map((c) => stats?.byCategory?.[c.value] || 0),
    1,
  );

  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-2.5 data-readout">
        SIGNAL DISTRIBUTION
      </div>
      <div className="space-y-2">
        {cats.map((cat) => {
          const count = stats?.byCategory?.[cat.value] || 0;
          const pct = (count / maxCount) * 100;
          return (
            <div key={cat.value} className="flex items-center gap-2">
              <span
                className="text-[9px] w-14 truncate uppercase data-readout"
                style={{ color: cat.color }}
              >
                {cat.shortLabel}
              </span>
              <div className="flex-1 h-1.5 bg-border/15 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: cat.color,
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className="text-[9px] data-readout text-muted-foreground/40 w-5 text-right">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendingPanel({ items }: { items: FeedItemWithBookmark[] }) {
  const trending = useMemo(() => extractTrending(items), [items]);
  if (trending.length === 0) return null;

  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-2.5 data-readout flex items-center gap-1">
        <TrendingUp size={9} />
        TRENDING
      </div>
      <div className="flex flex-wrap gap-1.5">
        {trending.map(({ word }) => (
          <span
            key={word}
            className="text-[10px] px-2 py-0.5 rounded-full border border-primary/10 text-primary/50 data-readout hover:text-primary/80 hover:border-primary/20 transition-colors cursor-default"
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}

function BreakingAlerts({ items }: { items: FeedItemWithBookmark[] }) {
  const breaking = items.filter((i) => i.isBreaking).slice(0, 5);
  if (breaking.length === 0) return null;

  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-red-400/60 mb-2.5 data-readout flex items-center gap-1">
        <AlertTriangle size={9} />
        BREAKING ALERTS
      </div>
      <div>
        {breaking.map((item) => (
          <div key={item.id} className="py-2 border-b border-border/10 last:border-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="text-[9px] data-readout"
                style={{ color: getSourceMeta(item.source).color }}
              >
                {item.sourceLabel}
              </span>
              <span className="text-[9px] data-readout text-muted-foreground/30 ml-auto">
                {timeAgo(item.publishedAt)}
              </span>
            </div>
            <p className="text-[11px] text-foreground/50 leading-tight line-clamp-2">
              {item.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({
  data,
  color,
  width = 120,
  height = 24,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const points = data
    .map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.6 }}
      />
    </svg>
  );
}

function FeedHealthBanner() {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery<{
    health: Record<string, any>;
    summary: { online: number; failing: number; total: number };
  }>({
    queryKey: ["/api/sources/health"],
    refetchInterval: 60000,
  });

  const summary = data?.summary;
  const health = data?.health;

  if (!summary || summary.total === 0) return null;

  const failingEntries = health
    ? Object.values(health).filter((h: any) => h.consecutiveFailures > 0)
    : [];

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-[10px] uppercase tracking-wider data-readout"
      >
        <span
          className={`w-2 h-2 rounded-full ${summary.failing > 0 ? "bg-amber-400" : "bg-green-400"}`}
        />
        <span className="text-muted-foreground/70">
          {summary.online}/{summary.total} SOURCES ONLINE
        </span>
        {summary.failing > 0 && (
          <span className="text-red-400 font-semibold ml-1">
            {summary.failing} FAILING
          </span>
        )}
        <span className="ml-auto text-muted-foreground/30">
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </span>
      </button>
      {expanded && failingEntries.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {failingEntries.map((h: any) => (
            <div
              key={h.source}
              className="text-[9px] px-2 py-1.5 rounded bg-red-950/20 border border-red-500/15"
            >
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span className="text-red-400/80 font-medium">
                  {getSourceMeta(h.source).label}
                </span>
                <span className="ml-auto text-muted-foreground/30">
                  {h.consecutiveFailures}x
                </span>
              </div>
              {h.lastError && (
                <p className="text-muted-foreground/40 mt-0.5 truncate">
                  {h.lastError}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceActivityPanel() {
  const { data: activity } = useQuery<Record<string, number[]>>({
    queryKey: ["/api/sources/activity"],
    refetchInterval: 120000,
  });

  const entries = Object.entries(activity || {})
    .map(([source, data]) => ({
      source,
      data,
      total: data.reduce((s, v) => s + v, 0),
      lastActive: data.length > 0
        ? data.length - 1 - [...data].reverse().findIndex((v) => v > 0)
        : -1,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const now = Date.now();

  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-2.5 data-readout">
        SOURCE ACTIVITY (7D)
      </div>
      <div className="space-y-2">
        {entries.map(({ source, data, total, lastActive }) => {
          const info = getSourceMeta(source);
          const totalHours = data.length;
          const hoursAgo = totalHours > 0 && lastActive >= 0 ? totalHours - 1 - lastActive : Infinity;
          let dotColor = "bg-red-400";
          if (hoursAgo < 24) dotColor = "bg-green-400";
          else if (hoursAgo < 72) dotColor = "bg-amber-400";

          return (
            <div key={source} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
              <span
                className="text-[9px] w-16 truncate data-readout"
                style={{ color: info.color }}
              >
                {info.label}
              </span>
              <Sparkline data={data} color={info.color} />
              <span className="text-[9px] data-readout text-muted-foreground/30 w-5 text-right">
                {total}
              </span>
            </div>
          );
        })}
        {entries.length === 0 && (
          <div className="text-[9px] text-muted-foreground/30 data-readout py-2">
            No activity data yet
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────

export default function Dashboard() {
  const [selectedCategory, setSelectedCategory] = useState<Category>("all");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [newSignals, setNewSignals] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => notifications.isEnabled(),
  );
  const [sortMode, setSortMode] = useState<"time" | "priority">(
    () => (localStorage.getItem("ai-noc-sort") as "time" | "priority") || "time",
  );

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Infinite scroll sentinel
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Persist sort preference
  useEffect(() => {
    localStorage.setItem("ai-noc-sort", sortMode);
  }, [sortMode]);

  // WebSocket for real-time push notifications
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        let wsUrl: string;
        if (apiUrl) {
          wsUrl = apiUrl.replace(/^http/, "ws") + "/ws";
        } else {
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          wsUrl = `${protocol}//${window.location.host}/ws`;
        }
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "new_items" && data.count > 0) {
              setNewSignals((prev) => prev + data.count);
            }
            if (data.type === "alert" && Array.isArray(data.items)) {
              if (notifications.isEnabled() && document.hidden) {
                for (const item of data.items) {
                  notifications.sendNotification(
                    `[P${item.priority}] ${item.sourceLabel}`,
                    item.title,
                    () => {
                      window.focus();
                      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
                    },
                  );
                }
              }
            }
          } catch {}
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 5000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // WebSocket not available (e.g. mixed content) — fall back to polling
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }, []);

  // ── Queries ──

  type FeedPage = { items: FeedItemWithBookmark[]; nextCursor: string | null };

  const {
    data: feedData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<FeedPage>({
    queryKey: ["/api/feed", selectedCategory, selectedSource, debouncedSearch, sortMode],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (selectedSource !== "all") params.set("source", selectedSource);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (sortMode !== "time") params.set("sort", sortMode);
      if (pageParam) params.set("cursor", pageParam as string);
      params.set("limit", "30");
      const res = await apiRequest("GET", `/api/feed?${params.toString()}`);
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    refetchInterval: 60000,
  });

  const feedItems: FeedItemWithBookmark[] = useMemo(
    () => feedData?.pages.flatMap((p) => p.items) ?? [],
    [feedData],
  );

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    refetchInterval: 30000,
  });

  const { data: bookmarksList = [] } = useQuery<any[]>({
    queryKey: ["/api/bookmarks"],
  });

  // Infinite scroll observer
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Mutations ──

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/feed/refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async ({
      feedItemId,
      isBookmarked,
    }: {
      feedItemId: number;
      isBookmarked: boolean;
    }) => {
      if (isBookmarked) {
        await apiRequest("DELETE", `/api/bookmarks/${feedItemId}`);
      } else {
        await apiRequest("POST", "/api/bookmarks", { feedItemId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    },
  });

  // ── Derived ──

  const breakingItems = feedItems.filter((i) => i.isBreaking);

  const groupedItems = useMemo(() => {
    if (sortMode === "priority") return []; // flat list when sorting by priority
    const order = ["TODAY", "YESTERDAY", "THIS WEEK", "EARLIER"];
    const map: Record<string, FeedItemWithBookmark[]> = {};
    for (const item of feedItems) {
      const g = getTimeGroup(item.publishedAt);
      (map[g] ??= []).push(item);
    }
    return order
      .filter((l) => map[l]?.length)
      .map((label) => ({ label, items: map[label] }));
  }, [feedItems, sortMode]);

  const sourceCount = Object.keys(stats?.bySource || {}).length;

  // ── Handlers ──

  const handleToggleBookmark = (id: number, isBookmarked: boolean) => {
    bookmarkMutation.mutate({ feedItemId: id, isBookmarked });
  };

  const handleSelectCategory = (cat: Category) => {
    setSelectedCategory(cat);
    setShowBookmarks(false);
  };

  const handleSelectSource = (source: string) => {
    setSelectedSource(selectedSource === source ? "all" : source);
    setShowBookmarks(false);
  };

  // ── Render ──

  return (
    <div className="h-screen flex flex-col scanlines grid-bg">
      {/* ═══ Header ═══ */}
      <header className="flex-shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm px-4 py-2 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg
              width="28"
              height="28"
              viewBox="0 0 32 32"
              fill="none"
              aria-label="AI Operations Center"
            >
              <rect x="2" y="2" width="28" height="28" rx="4" stroke="hsl(175,85%,40%)" strokeWidth="1.5" fill="none" />
              <circle cx="16" cy="16" r="6" stroke="hsl(175,85%,40%)" strokeWidth="1.5" fill="none" />
              <circle cx="16" cy="16" r="2" fill="hsl(175,85%,40%)" />
              <line x1="16" y1="2" x2="16" y2="10" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
              <line x1="16" y1="22" x2="16" y2="30" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
              <line x1="2" y1="16" x2="10" y2="16" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
              <line x1="22" y1="16" x2="30" y2="16" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
            </svg>
            <div>
              <h1 className="text-sm font-bold tracking-wider uppercase text-primary glow-text-cyan">
                AI OPS CENTER
              </h1>
              <p className="text-[10px] text-muted-foreground tracking-wider hidden sm:block">
                INTELLIGENCE MONITORING & OBSERVABILITY
              </p>
            </div>
          </div>

          <StatusBar lastSynced={stats?.lastRefreshed} />

          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors data-readout"
            >
              <RefreshCw
                size={12}
                className={refreshMutation.isPending ? "animate-spin" : ""}
              />
              <span className="hidden sm:inline">
                {refreshMutation.isPending ? "SYNCING" : "SYNC"}
              </span>
            </button>
            <button
              onClick={() => setShowBookmarks(!showBookmarks)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors data-readout ${
                showBookmarks
                  ? "border-amber-400/30 text-amber-400 bg-amber-400/10"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Bookmark size={12} />
              <span className="hidden sm:inline">SAVED</span>
              <span className="data-readout">({bookmarksList.length})</span>
            </button>
            <button
              onClick={async () => {
                if (!notificationsEnabled) {
                  const granted = await notifications.requestPermission();
                  setNotificationsEnabled(granted);
                } else {
                  notifications.setEnabled(false);
                  setNotificationsEnabled(false);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors data-readout ${
                notificationsEnabled
                  ? "border-primary/30 text-primary bg-primary/10"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
              title={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
            >
              {notificationsEnabled ? <Bell size={12} /> : <BellOff size={12} />}
            </button>
          </div>
        </div>
      </header>

      {/* ═══ Mobile Category Bar ═══ */}
      <div className="lg:hidden flex-shrink-0 border-b border-border/30 px-3 py-2 overflow-x-auto hide-scrollbar bg-card/20">
        <div className="flex gap-1.5">
          {CATEGORIES.map((cat) => {
            const count =
              cat.value === "all"
                ? stats?.total || 0
                : stats?.byCategory?.[cat.value] || 0;
            const isActive =
              selectedCategory === cat.value && !showBookmarks;
            return (
              <button
                key={cat.value}
                onClick={() => handleSelectCategory(cat.value)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] uppercase tracking-wider font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "text-muted-foreground border border-border/30 hover:text-foreground"
                }`}
              >
                {cat.shortLabel}
                <span className="data-readout opacity-50">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ Main Content ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── Left Sidebar ─── */}
        <nav className="hidden lg:flex lg:flex-col w-52 flex-shrink-0 border-r border-border/50 bg-sidebar overflow-y-auto">
          {/* Categories */}
          <div className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2 px-2 data-readout">
              CATEGORIES
            </div>
            {CATEGORIES.map((cat) => {
              const CatIcon = cat.icon;
              const count =
                cat.value === "all"
                  ? stats?.total || 0
                  : stats?.byCategory?.[cat.value] || 0;
              const isActive =
                selectedCategory === cat.value && !showBookmarks;
              return (
                <button
                  key={cat.value}
                  onClick={() => handleSelectCategory(cat.value)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded text-xs transition-all ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent"
                  }`}
                >
                  <CatIcon
                    size={14}
                    style={isActive ? { color: cat.color } : undefined}
                  />
                  <span className="flex-1 text-left tracking-wider uppercase text-[10px] font-medium">
                    {cat.label}
                  </span>
                  <span className="data-readout text-[10px] opacity-50">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sources - now clickable for filtering */}
          <div className="p-3 border-t border-border/20 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2 px-2 data-readout">
              SOURCES
            </div>
            {Object.entries(stats?.bySource || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 14)
              .map(([source, count]) => {
                const info = getSourceMeta(source);
                const SrcIcon = info.icon;
                const isActive = selectedSource === source;
                return (
                  <button
                    key={source}
                    onClick={() => handleSelectSource(source)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] transition-all ${
                      isActive
                        ? "bg-primary/10 border border-primary/20"
                        : "border border-transparent hover:bg-card/50"
                    }`}
                  >
                    <SrcIcon size={11} style={{ color: info.color }} />
                    <span
                      className={`flex-1 truncate text-left ${
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {info.label}
                    </span>
                    <span className="data-readout opacity-40">{count}</span>
                  </button>
                );
              })}
          </div>
        </nav>

        {/* ─── Center Feed ─── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* KPI Row */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-border/20 bg-card/10">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
              <KpiCard
                label="TOTAL SIGNALS"
                value={stats?.total || 0}
                icon={Radio}
                color="hsl(175,85%,50%)"
              />
              <KpiCard
                label="HIGH PRIORITY"
                value={stats?.breakingCount || 0}
                icon={AlertTriangle}
                color="hsl(0,70%,55%)"
              />
              <KpiCard
                label="MODEL RELEASES"
                value={stats?.byCategory?.model_release || 0}
                icon={Brain}
                color="hsl(175,85%,50%)"
              />
              <KpiCard
                label="SOURCES ACTIVE"
                value={sourceCount}
                icon={Activity}
                color="hsl(140,60%,50%)"
              />
            </div>
          </div>

          {/* Search + Active Filters */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-border/20 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40"
              />
              <input
                type="search"
                placeholder="Search signals..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 text-xs rounded border border-border/40 bg-card/20 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 data-readout"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {selectedSource !== "all" && (
                <button
                  onClick={() => setSelectedSource("all")}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 data-readout hover:bg-primary/15 transition-colors"
                >
                  {getSourceMeta(selectedSource).label}
                  <X size={10} />
                </button>
              )}
              <button
                onClick={() => setSortMode(sortMode === "time" ? "priority" : "time")}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border data-readout transition-colors ${
                  sortMode === "priority"
                    ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                    : "text-muted-foreground/50 border-border/30 hover:text-foreground"
                }`}
              >
                <ArrowUpDown size={10} />
                {sortMode === "priority" ? "PRIORITY" : "LATEST"}
              </button>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40 data-readout">
                <Filter size={10} />
                <span>{feedItems.length} signals</span>
              </div>
            </div>
          </div>

          {/* Live update notification */}
          {newSignals > 0 && (
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
                queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
                setNewSignals(0);
              }}
              className="flex-shrink-0 px-4 py-2 border-b border-primary/20 bg-primary/5 flex items-center justify-center gap-2 text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer data-readout"
            >
              <Radio size={12} className="status-pulse" />
              {newSignals} new signal{newSignals !== 1 ? "s" : ""} detected
              -- click to load
            </button>
          )}

          {/* Breaking Ticker */}
          {breakingItems.length > 0 && !showBookmarks && (
            <div className="flex-shrink-0 px-4 py-2 border-b border-red-500/15 bg-red-950/10">
              <div className="flex items-center gap-3 text-xs">
                <span className="flex-shrink-0 flex items-center gap-1 text-red-400/80 font-semibold uppercase tracking-wider text-[10px]">
                  <AlertTriangle size={11} className="status-pulse" />
                  BREAKING
                </span>
                <div className="flex-1 overflow-hidden">
                  <div className="flex whitespace-nowrap animate-marquee">
                    {[...breakingItems, ...breakingItems].map((item, idx) => (
                      <span
                        key={`${item.id}-${idx}`}
                        className="inline-flex items-center mr-8"
                      >
                        <span
                          className="font-medium"
                          style={{
                            color: getSourceMeta(item.source).color,
                          }}
                        >
                          {item.sourceLabel}
                        </span>
                        <span className="mx-2 text-muted-foreground/40">
                          :
                        </span>
                        <span className="text-muted-foreground/70">
                          {item.title}
                        </span>
                        <span className="text-border/30 mx-4">|</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Feed Stream */}
          <div
            className="flex-1 overflow-y-auto px-4 py-3"
            style={{ overscrollBehavior: "contain" }}
          >
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="border border-border/30 rounded bg-card/20 px-4 py-3 border-l-[3px] border-l-border/20"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded skeleton-shimmer" />
                      <div className="flex-1 space-y-2">
                        <div className="flex gap-2">
                          <div className="h-3 w-16 rounded skeleton-shimmer" />
                          <div className="h-3 w-14 rounded skeleton-shimmer" />
                        </div>
                        <div className="h-4 w-4/5 rounded skeleton-shimmer" />
                        <div className="h-3 w-3/5 rounded skeleton-shimmer" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : showBookmarks ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-3 flex items-center gap-1.5 data-readout">
                  <BookmarkCheck size={12} />
                  SAVED SIGNALS ({bookmarksList.length})
                </div>
                {bookmarksList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Bookmark size={28} className="mb-3 opacity-20" />
                    <p className="text-sm opacity-60">No saved signals</p>
                    <p className="text-xs mt-1 opacity-30">
                      Bookmark items to track them here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {bookmarksList.map(
                      (bm: any) =>
                        bm.feedItem && (
                          <FeedCard
                            key={bm.id}
                            item={{ ...bm.feedItem, isBookmarked: true }}
                            onToggleBookmark={handleToggleBookmark}
                          />
                        ),
                    )}
                  </div>
                )}
              </div>
            ) : sortMode === "priority" ? (
              /* Priority sort: flat list, no time groups */
              <div className="space-y-1.5">
                {feedItems.map((item, i) => (
                  <div
                    key={item.id}
                    className="feed-enter"
                    style={{ animationDelay: `${Math.min(i * 25, 200)}ms` }}
                  >
                    <FeedCard
                      item={item}
                      onToggleBookmark={handleToggleBookmark}
                    />
                  </div>
                ))}
                {feedItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Radio size={28} className="mb-3 opacity-20" />
                    <p className="text-sm opacity-60">No signals detected</p>
                    <p className="text-xs mt-1 opacity-30">
                      Try adjusting your filters or sync feeds
                    </p>
                  </div>
                )}
                {/* Infinite scroll sentinel */}
                <div ref={loadMoreRef} className="h-4" />
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4 text-xs text-muted-foreground/40 data-readout gap-2">
                    <RefreshCw size={12} className="animate-spin" />
                    Loading more signals...
                  </div>
                )}
              </div>
            ) : (
              /* Time sort: grouped by day */
              <div className="space-y-4">
                {groupedItems.map((group) => (
                  <div key={group.label}>
                    {/* Time group header */}
                    <div className="flex items-center gap-3 py-1.5 mb-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 data-readout font-medium">
                        {group.label}
                      </span>
                      <div className="flex-1 h-px bg-border/15" />
                      <span className="text-[10px] text-muted-foreground/30 data-readout">
                        {group.items.length}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {group.items.map((item, i) => (
                        <div
                          key={item.id}
                          className="feed-enter"
                          style={{
                            animationDelay: `${Math.min(i * 25, 200)}ms`,
                          }}
                        >
                          <FeedCard
                            item={item}
                            onToggleBookmark={handleToggleBookmark}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {feedItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Radio size={28} className="mb-3 opacity-20" />
                    <p className="text-sm opacity-60">No signals detected</p>
                    <p className="text-xs mt-1 opacity-30">
                      Try adjusting your filters or sync feeds
                    </p>
                  </div>
                )}
                {/* Infinite scroll sentinel */}
                <div ref={loadMoreRef} className="h-4" />
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4 text-xs text-muted-foreground/40 data-readout gap-2">
                    <RefreshCw size={12} className="animate-spin" />
                    Loading more signals...
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* ─── Right Panel: Signal Intelligence ─── */}
        <aside
          className="hidden xl:flex xl:flex-col w-72 flex-shrink-0 border-l border-border/50 bg-sidebar overflow-y-auto"
          style={{ overscrollBehavior: "contain" }}
        >
          <div className="p-4 space-y-5">
            <div className="text-[10px] uppercase tracking-wider text-primary/60 flex items-center gap-1.5 data-readout">
              <Activity size={10} />
              SIGNAL INTELLIGENCE
            </div>

            <CategoryDistribution stats={stats} />

            <div className="h-px bg-border/10" />
            <TrendingPanel items={feedItems} />

            <div className="h-px bg-border/10" />
            <BreakingAlerts items={feedItems} />

            <div className="h-px bg-border/10" />
            <FeedHealthBanner />

            <div className="h-px bg-border/10" />
            <SourceActivityPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
