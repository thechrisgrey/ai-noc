import { Activity } from "lucide-react";
import { type FeedItemWithBookmark, type Stats } from "./constants";
import { CategoryDistribution } from "./CategoryDistribution";
import { TrendingPanel } from "./TrendingPanel";
import { BreakingAlerts } from "./BreakingAlerts";
import { FeedHealthBanner } from "./FeedHealthBanner";
import { SourceActivityPanel } from "./SourceActivityPanel";

interface IntelPanelProps {
  stats?: Stats;
  feedItems: FeedItemWithBookmark[];
}

export function IntelPanel({ stats, feedItems }: IntelPanelProps) {
  return (
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
  );
}
