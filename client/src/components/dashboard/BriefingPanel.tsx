import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronUp, Archive } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { timeAgo } from "./utils";

interface ArchivedBriefing {
  id: number;
  content: string;
  itemCount: number;
  generatedAt: string;
  kind: string;
}

type ArchiveFilter = "all" | "hourly" | "daily_digest";

const ARCHIVE_FILTERS: { value: ArchiveFilter; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "hourly", label: "HOURLY" },
  { value: "daily_digest", label: "DIGEST" },
];

/** Render briefing content as paragraphs, styling '## ' lines as micro-caps
 * section headers. No markdown dependency — a simple line-split renderer. */
function BriefingContent({ content }: { content: string }) {
  return (
    <div className="space-y-1.5">
      {content.split("\n").map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed === "") return null;
        if (trimmed.startsWith("## ")) {
          return (
            <div
              key={idx}
              className="text-[10px] uppercase tracking-[0.14em] font-medium text-primary/90 data-readout pt-2"
            >
              {trimmed.slice(3)}
            </div>
          );
        }
        return (
          <p key={idx} className="text-[12px] text-foreground/80 leading-relaxed whitespace-pre-line">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

function ArchivePanel() {
  const [filter, setFilter] = useState<ArchiveFilter>("all");

  const { data: briefings = [], isLoading } = useQuery<ArchivedBriefing[]>({
    queryKey: ["/api/briefings", filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("kind", filter);
      params.set("limit", "50");
      const res = await apiRequest("GET", `/api/briefings?${params.toString()}`);
      return res.json();
    },
  });

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
      <div className="flex items-center gap-1.5">
        {ARCHIVE_FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              aria-pressed={active}
              className={`text-[9px] px-2 py-1 rounded-lg data-readout uppercase tracking-[0.14em] transition-colors ${
                active
                  ? "bg-primary/[0.12] border border-primary/20 text-primary"
                  : "border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:text-foreground hover:bg-white/[0.07]"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <p className="text-[10px] text-muted-foreground/60 data-readout">LOADING...</p>
      )}
      {!isLoading && briefings.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60 data-readout">NO BRIEFINGS ARCHIVED</p>
      )}

      {briefings.map((b) => (
        <div
          key={b.id}
          className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2"
        >
          <div className="flex items-center gap-2 text-[9px] data-readout text-muted-foreground/70">
            <span
              className={`px-1.5 py-0.5 rounded uppercase tracking-[0.14em] ${
                b.kind === "daily_digest"
                  ? "bg-primary/[0.12] text-primary"
                  : "bg-white/[0.06] text-muted-foreground"
              }`}
            >
              {b.kind === "daily_digest" ? "DIGEST" : "HOURLY"}
            </span>
            <span className="tabular-nums">{timeAgo(b.generatedAt)}</span>
            <span className="ml-auto tabular-nums">{b.itemCount} SIGNALS</span>
          </div>
          <BriefingContent content={b.content} />
        </div>
      ))}
    </div>
  );
}

function BriefingArchiveSheet() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Open briefing archive"
          className="flex-shrink-0 flex items-center gap-1 text-[9px] tracking-[0.14em] px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground data-readout transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Archive size={10} />
          ARCHIVE
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-card border-white/[0.08] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <SheetTitle className="text-xs uppercase tracking-[0.14em] font-medium data-readout">
            BRIEFING ARCHIVE
          </SheetTitle>
          <SheetDescription className="text-[10px] text-muted-foreground">
            Past intelligence briefings and daily digests.
          </SheetDescription>
        </SheetHeader>
        {/* Query hooks live below SheetContent so they only mount when open. */}
        {open && <ArchivePanel />}
      </SheetContent>
    </Sheet>
  );
}

export function BriefingPanel() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("ai-noc-briefing-collapsed") === "true",
  );
  const { toast } = useToast();

  const { data: briefing } = useQuery<{
    content: string | null;
    generatedAt: string | null;
    itemCount: number;
  }>({
    queryKey: ["/api/briefing"],
    refetchInterval: 5 * 60 * 1000,
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/briefing/regenerate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
    },
    onError: () => {
      toast({ title: "BRIEFING FAILED", description: "Could not regenerate briefing. Try again.", variant: "destructive" });
    },
  });

  useEffect(() => {
    localStorage.setItem("ai-noc-briefing-collapsed", String(collapsed));
  }, [collapsed]);

  if (!briefing?.content && !regenerateMutation.isPending) return null;

  return (
    <div className="flex-shrink-0 bg-primary/[0.04] border-b border-b-white/[0.06] border-l-2 border-l-primary/40">
      <div className="w-full flex items-center gap-2 pr-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex-1 flex items-center gap-2 pl-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Activity size={12} className="text-primary/90" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-primary/90 data-readout font-medium">
            INTELLIGENCE BRIEFING
          </span>
          {briefing?.generatedAt && (
            <span className="text-[9px] text-muted-foreground/60 data-readout">
              {timeAgo(briefing.generatedAt)}
            </span>
          )}
          <span className="ml-auto">
            {collapsed ? (
              <ChevronDown size={12} className="text-muted-foreground/60" />
            ) : (
              <ChevronUp size={12} className="text-muted-foreground/60" />
            )}
          </span>
        </button>
        <BriefingArchiveSheet />
        <button
          onClick={() => regenerateMutation.mutate()}
          disabled={regenerateMutation.isPending}
          className={`flex-shrink-0 text-[9px] tracking-[0.14em] px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-foreground/80 hover:bg-white/[0.07] hover:text-foreground data-readout transition-colors cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            regenerateMutation.isPending ? "animate-pulse" : ""
          }`}
        >
          {regenerateMutation.isPending ? "GENERATING..." : "REGENERATE"}
        </button>
      </div>
      {!collapsed && (
        <div className="px-4 pb-3">
          <p className="text-[13px] font-sans text-foreground/85 leading-relaxed max-w-3xl">
            {regenerateMutation.isPending
              ? "Analyzing top signals..."
              : briefing?.content || "Briefing will be generated shortly..."}
          </p>
        </div>
      )}
    </div>
  );
}
