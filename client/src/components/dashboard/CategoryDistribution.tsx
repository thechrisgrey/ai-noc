import { CATEGORIES, type Stats } from "./constants";

export function CategoryDistribution({ stats }: { stats?: Stats }) {
  const cats = CATEGORIES.filter((c) => c.value !== "all");
  const maxCount = Math.max(
    ...cats.map((c) => stats?.byCategory?.[c.value] || 0),
    1,
  );

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-3 data-readout">
        SIGNAL DISTRIBUTION
      </div>
      <div className="space-y-2.5">
        {cats.map((cat) => {
          const count = stats?.byCategory?.[cat.value] || 0;
          const pct = (count / maxCount) * 100;
          return (
            <div key={cat.value} className="flex items-center gap-2">
              <span
                className="text-[10px] w-16 truncate uppercase data-readout"
                style={{ color: cat.color }}
              >
                {cat.shortLabel}
              </span>
              <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: cat.color,
                    opacity: 0.8,
                    boxShadow: `0 0 6px ${cat.color}`,
                  }}
                />
              </div>
              <span className="text-[10px] data-readout tabular-nums text-muted-foreground w-5 text-right">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
