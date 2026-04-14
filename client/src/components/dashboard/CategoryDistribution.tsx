import { CATEGORIES, type Stats } from "./constants";

export function CategoryDistribution({ stats }: { stats?: Stats }) {
  const cats = CATEGORIES.filter((c) => c.value !== "all");
  const maxCount = Math.max(
    ...cats.map((c) => stats?.byCategory?.[c.value] || 0),
    1,
  );

  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-2.5 data-readout">
        SIGNAL DISTRIBUTION
      </div>
      <div className="space-y-2">
        {cats.map((cat) => {
          const count = stats?.byCategory?.[cat.value] || 0;
          const pct = (count / maxCount) * 100;
          return (
            <div key={cat.value} className="flex items-center gap-2">
              <span
                className="text-[9px] w-14 truncate uppercase data-readout"
                style={{ color: cat.color }}
              >
                {cat.shortLabel}
              </span>
              <div className="flex-1 h-1.5 bg-border/15 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: cat.color,
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className="text-[9px] data-readout text-muted-foreground/40 w-5 text-right">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
