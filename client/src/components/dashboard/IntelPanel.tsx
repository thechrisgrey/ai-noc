import { lazy, Suspense } from "react";
import { Activity } from "lucide-react";
import { type FeedItemWithBookmark, type Stats, type SectionFilter } from "./constants";
import { CategoryDistribution } from "./CategoryDistribution";
import { TrendingPanel } from "./TrendingPanel";
import { BreakingAlerts } from "./BreakingAlerts";
import { FeedHealthBanner } from "./FeedHealthBanner";
import { SourceActivityPanel } from "./SourceActivityPanel";
import { SourceIntelPanel } from "./SourceIntelPanel";

const SignalGlobe = lazy(() => import("@/components/three/SignalGlobe"));

interface IntelPanelProps {
  stats?: Stats;
  feedItems: FeedItemWithBookmark[];
  section: SectionFilter;
}

const SECTION_CARD =
  "rounded-2xl bg-card border border-white/[0.06] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_4px_16px_rgba(0,0,0,0.35)] empty:hidden";

export function IntelPanel({ stats, feedItems, section }: IntelPanelProps) {
  const sourceCount = Object.keys(stats?.bySource || {}).length;

  return (
    <aside
      className="hidden xl:flex xl:flex-col w-72 flex-shrink-0 border-l border-sidebar-border bg-sidebar overflow-y-auto"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="p-4 space-y-4">
        <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground flex items-center gap-1.5 data-readout">
          <Activity size={10} className="text-primary" />
          SIGNAL INTELLIGENCE
        </div>

        <section className={`${SECTION_CARD} overflow-hidden`}>
          <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground data-readout">
            GLOBAL SIGNALS
          </div>
          <Suspense fallback={null}>
            <div className="h-[190px] -mx-2" aria-hidden="true">
              <SignalGlobe className="h-full w-full" />
            </div>
          </Suspense>
          <div className="text-[10px] data-readout text-muted-foreground tabular-nums">
            {sourceCount} SOURCES TRANSMITTING
          </div>
        </section>

        <section className={SECTION_CARD}>
          <CategoryDistribution stats={stats} />
        </section>

        <section className={SECTION_CARD}>
          <TrendingPanel items={feedItems} />
        </section>

        <section className={SECTION_CARD}>
          <BreakingAlerts items={feedItems} />
        </section>

        <section className={SECTION_CARD}>
          <FeedHealthBanner section={section} />
        </section>

        <section className={SECTION_CARD}>
          <SourceIntelPanel section={section} />
        </section>

        <section className={SECTION_CARD}>
          <SourceActivityPanel section={section} />
        </section>
      </div>
    </aside>
  );
}
