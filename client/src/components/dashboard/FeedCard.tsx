import { Bookmark, BookmarkCheck, ExternalLink, AlertTriangle, Clock } from "lucide-react";
import { CATEGORY_COLORS, type FeedItemWithBookmark } from "./constants";
import { getSourceMeta, timeAgo } from "./utils";

export function FeedCard({
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

          {/* Description preview */}
          {item.description && (
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {/* Actions */}
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
