import { AlertTriangle } from "lucide-react";
import { type FeedItemWithBookmark } from "./constants";
import { getSourceMeta, timeAgo } from "./utils";

export function BreakingAlerts({ items }: { items: FeedItemWithBookmark[] }) {
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
              <span className="text-[9px] data-readout text-muted-foreground/60 ml-auto">
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
