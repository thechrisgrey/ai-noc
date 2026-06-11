import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { type FeedItemWithBookmark } from "./constants";
import { extractTrending } from "./utils";

export function TrendingPanel({ items }: { items: FeedItemWithBookmark[] }) {
  const trending = useMemo(() => extractTrending(items), [items]);
  if (trending.length === 0) return null;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-3 data-readout flex items-center gap-1.5">
        <TrendingUp size={10} className="text-primary" />
        TRENDING
      </div>
      <div className="flex flex-wrap gap-1.5">
        {trending.map(({ word }) => (
          <span
            key={word}
            className="text-[10px] px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-muted-foreground data-readout hover:text-primary hover:border-primary/25 hover:bg-primary/10 transition-colors cursor-default"
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}
