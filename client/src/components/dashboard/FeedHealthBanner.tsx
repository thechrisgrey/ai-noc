import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getSourceMeta } from "./utils";

export function FeedHealthBanner() {
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
        aria-expanded={expanded}
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
