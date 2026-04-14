import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { type FeedItemWithBookmark } from "./constants";
import { extractTrending } from "./utils";

export function TrendingPanel({ items }: { items: FeedItemWithBookmark[] }) {
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
