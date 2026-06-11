import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, ExternalLink, AlertTriangle, Clock, ChevronDown } from "lucide-react";
import type { FeedItem } from "@shared/schema";
import { CATEGORY_COLORS, type FeedItemWithBookmark } from "./constants";
import { getSourceMeta, timeAgo } from "./utils";

export function FeedCard({
  item,
  onToggleBookmark,
  onMarkRead,
  isSelected = false,
}: {
  item: FeedItemWithBookmark;
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
  onMarkRead?: (id: number) => void;
  isSelected?: boolean;
}) {
  const sourceInfo = getSourceMeta(item.source);
  const SourceIcon = sourceInfo.icon;
  const catColor = CATEGORY_COLORS[item.category] || "hsl(68, 95%, 60%)";
  const pri = (item as any).priority as number || 0;
  const isHigh = pri >= 80;
  const isMedium = pri >= 60 && pri < 80;
  const isUnread = !item.readAt;
  const coverageCount = item.coverageCount ?? 1;

  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isSelected) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isSelected]);

  const { data: siblings = [], isLoading: siblingsLoading } = useQuery<FeedItem[]>({
    queryKey: ["/api/items", item.id, "cluster"],
    enabled: expanded,
  });

  return (
    <div
      ref={cardRef}
      onClick={() => isUnread && onMarkRead?.(item.id)}
      className={`group relative rounded-xl border border-l-2 bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_10px_rgba(0,0,0,0.35)] transition-colors duration-200 ${
        isUnread ? "border-l-primary/60" : "border-l-transparent"
      } ${isSelected ? "ring-1 ring-primary/50 " : ""}${
        isHigh
          ? "border-red-500/25 hover:border-red-500/40"
          : isMedium
            ? "border-amber-500/20 hover:border-amber-500/35"
            : "border-white/[0.06] hover:border-white/[0.12]"
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Source icon */}
        <div
          className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: `color-mix(in srgb, ${sourceInfo.color} 12%, transparent)`,
          }}
        >
          <SourceIcon size={14} style={{ color: sourceInfo.color }} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className="text-[11px] font-medium"
              style={{ color: sourceInfo.color }}
            >
              {item.sourceLabel}
            </span>
            <span
              className="text-[9px] uppercase tracking-[0.14em] font-medium px-2 py-px rounded-full"
              style={{
                color: catColor,
                backgroundColor: `color-mix(in srgb, ${catColor} 12%, transparent)`,
              }}
            >
              {item.category.replace("_", " ")}
            </span>
            {coverageCount > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                aria-expanded={expanded}
                className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] font-medium px-2 py-px rounded-full bg-white/[0.06] text-muted-foreground hover:text-foreground data-readout transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                +{coverageCount - 1} SOURCES
                <ChevronDown
                  size={9}
                  className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            )}
            {isHigh && (
              <span className="pulse-breaking flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] font-semibold text-red-400 bg-red-500/[0.12] px-2 py-px rounded-full">
                <AlertTriangle size={9} />
                HIGH PRIORITY
              </span>
            )}
            {isMedium && (
              <span className="text-[9px] uppercase tracking-[0.14em] font-semibold text-amber-400/90 bg-amber-500/10 px-2 py-px rounded-full">
                NOTABLE
              </span>
            )}
            {pri > 0 && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="block w-10 h-1 rounded-full bg-white/[0.06] overflow-hidden"
                >
                  <span
                    className="block h-full heat-bar"
                    style={{ width: `${Math.min(pri, 100)}%` }}
                  />
                </span>
                <span className="text-[10px] data-readout text-muted-foreground/60">
                  P{pri}
                </span>
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground/60 data-readout flex items-center gap-1 flex-shrink-0">
              {isUnread && (
                <span
                  aria-hidden="true"
                  data-unread-indicator
                  className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"
                />
              )}
              <Clock size={9} />
              {timeAgo(item.publishedAt)}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-[13px] font-medium text-foreground/90 leading-snug mb-1">
            {item.title}
          </h3>

          {/* Description preview */}
          {item.description && (
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
              {item.description}
            </p>
          )}

          {/* Cluster siblings (other sources covering this story) */}
          {expanded && (
            <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-1">
              {siblingsLoading ? (
                <div className="text-[10px] text-muted-foreground/60 data-readout">
                  Loading coverage...
                </div>
              ) : siblings.length === 0 ? (
                <div className="text-[10px] text-muted-foreground/60 data-readout">
                  No other coverage found
                </div>
              ) : (
                siblings.map((sib, i) => (
                  <div key={sib.id} className="flex items-center gap-2 min-w-0">
                    {i === 0 && (
                      <span className="flex-shrink-0 text-[8px] uppercase tracking-[0.14em] font-semibold text-primary bg-primary/10 px-1.5 py-px rounded-full">
                        FIRST
                      </span>
                    )}
                    <span
                      className="flex-shrink-0 text-[10px] font-medium"
                      style={{ color: getSourceMeta(sib.source).color }}
                    >
                      {sib.sourceLabel}
                    </span>
                    {sib.url ? (
                      <a
                        href={sib.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="truncate text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {sib.title}
                      </a>
                    ) : (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {sib.title}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div
          className={`flex items-center gap-0.5 flex-shrink-0 mt-1 transition-opacity ${
            item.isBookmarked
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
        >
          <button
            onClick={() => onToggleBookmark(item.id, item.isBookmarked)}
            className={`p-1.5 rounded-lg transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
              item.isBookmarked
                ? "text-amber-400 hover:text-amber-300"
                : "text-muted-foreground hover:text-amber-400"
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
              onClick={() => isUnread && onMarkRead?.(item.id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
