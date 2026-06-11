import { AlertTriangle } from "lucide-react";
import { type FeedItemWithBookmark } from "./constants";
import { getSourceMeta, timeAgo } from "./utils";

export function BreakingAlerts({ items }: { items: FeedItemWithBookmark[] }) {
  const breaking = items.filter((i) => i.isBreaking).slice(0, 5);
  if (breaking.length === 0) return null;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-red-400/90 mb-2.5 data-readout flex items-center gap-1.5">
        <AlertTriangle size={10} />
        BREAKING ALERTS
      </div>
      <div>
        {breaking.map((item) => (
          <div
            key={item.id}
            className="py-2 border-b border-white/[0.06] last:border-0"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="text-[9px] data-readout"
                style={{ color: getSourceMeta(item.source).color }}
              >
                {item.sourceLabel}
              </span>
              <span className="text-[9px] data-readout text-muted-foreground/60 ml-auto">
                {timeAgo(item.publishedAt)}
              </span>
            </div>
            <p className="text-[11px] text-foreground/75 leading-snug line-clamp-2">
              {item.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
