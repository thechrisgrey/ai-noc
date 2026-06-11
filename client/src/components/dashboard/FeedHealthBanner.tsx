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
        className="w-full flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] font-medium data-readout rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span
          className={`w-2 h-2 rounded-full ${
            summary.failing > 0
              ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
              : "bg-primary shadow-[0_0_6px_hsla(68,96%,58%,0.5)]"
          }`}
        />
        <span className="text-muted-foreground">
          {summary.online}/{summary.total} SOURCES ONLINE
        </span>
        {summary.failing > 0 && (
          <span className="text-amber-400 font-semibold ml-1">
            {summary.failing} FAILING
          </span>
        )}
        <span className="ml-auto text-muted-foreground/60">
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </span>
      </button>
      {expanded && failingEntries.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {failingEntries.map((h: any) => (
            <div
              key={h.source}
              className="text-[9px] px-2.5 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15"
            >
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-amber-400/90 font-medium">
                  {getSourceMeta(h.source).label}
                </span>
                <span className="ml-auto text-muted-foreground/60 data-readout">
                  {h.consecutiveFailures}x
                </span>
              </div>
              {h.lastError && (
                <p className="text-muted-foreground/60 mt-1 truncate">
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
