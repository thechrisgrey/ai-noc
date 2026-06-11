import { useQuery } from "@tanstack/react-query";
import { Sparkline } from "./Sparkline";
import { getSourceMeta } from "./utils";

export function SourceActivityPanel() {
  const { data: activity } = useQuery<Record<string, number[]>>({
    queryKey: ["/api/sources/activity"],
    refetchInterval: 120000,
  });

  const entries = Object.entries(activity || {})
    .map(([source, data]) => ({
      source,
      data,
      total: data.reduce((s, v) => s + v, 0),
      lastActive: data.length > 0
        ? data.length - 1 - [...data].reverse().findIndex((v) => v > 0)
        : -1,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-3 data-readout">
        SOURCE ACTIVITY (7D)
      </div>
      <div className="space-y-2">
        {entries.map(({ source, data, total, lastActive }) => {
          const info = getSourceMeta(source);
          const totalHours = data.length;
          const hoursAgo = totalHours > 0 && lastActive >= 0 ? totalHours - 1 - lastActive : Infinity;
          let dotColor = "bg-[hsl(5,80%,62%)]";
          if (hoursAgo < 24) dotColor = "bg-[hsl(150,60%,55%)]";
          else if (hoursAgo < 72) dotColor = "bg-[hsl(38,95%,60%)]";

          return (
            <div key={source} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
              <span
                className="text-[10px] w-16 truncate data-readout"
                style={{ color: info.color }}
              >
                {info.label}
              </span>
              <Sparkline data={data} color="hsl(68,96%,58%)" width={100} />
              <span className="text-[10px] data-readout tabular-nums text-muted-foreground w-5 text-right">
                {total}
              </span>
            </div>
          );
        })}
        {entries.length === 0 && (
          <div className="text-[10px] text-muted-foreground data-readout py-2">
            No activity data yet
          </div>
        )}
      </div>
    </div>
  );
}
