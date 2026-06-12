import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getSourceMeta } from "./utils";
import type { SectionFilter } from "./constants";

interface SourceIntelRow {
  source: string;
  sourceLabel: string;
  firsts: number;
  contested: number;
  medianLagSeconds: number | null;
}

interface SourceIntelResponse {
  windowDays: number;
  sources: SourceIntelRow[];
}

const WINDOWS: { value: number; label: string }[] = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
];

// Format median trailing lag: hide sub-minute noise, minutes under an hour,
// otherwise tenths of an hour. Returns null when there is nothing to show.
function formatLag(seconds: number | null): string | null {
  if (seconds == null || seconds < 60) return null;
  if (seconds < 3600) return `+${Math.round(seconds / 60)}m`;
  return `+${(seconds / 3600).toFixed(1)}h`;
}

export function SourceIntelPanel({ section }: { section: SectionFilter }) {
  const [days, setDays] = useState(7);

  const { data } = useQuery<SourceIntelResponse>({
    queryKey: ["/api/sources/intel", days, section],
    queryFn: async () => {
      const sectionQs = section !== "all" ? `&section=${section}` : "";
      const res = await apiRequest("GET", `/api/sources/intel?days=${days}${sectionQs}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return null;

  const rows = data.sources.slice(0, 8);

  return (
    <div>
      <div className="flex items-center mb-3">
        <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground data-readout">
          SOURCE INTEL
        </div>
        <div className="ml-auto flex items-center gap-1">
          {WINDOWS.map((w) => {
            const active = days === w.value;
            return (
              <button
                key={w.value}
                onClick={() => setDays(w.value)}
                aria-pressed={active}
                className={`text-[9px] px-2 py-1 rounded-lg data-readout uppercase tracking-[0.14em] transition-colors ${
                  active
                    ? "bg-primary/[0.12] border border-primary/20 text-primary"
                    : "border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:text-foreground hover:bg-white/[0.07]"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-[10px] text-muted-foreground data-readout py-2">
          INSUFFICIENT CLUSTER DATA
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row, i) => {
            const info = getSourceMeta(row.source);
            const Icon = info.icon;
            const lead = row.contested > 0 ? row.firsts / row.contested : 0;
            const lag = formatLag(row.medianLagSeconds);

            return (
              <div key={row.source} className="flex items-center gap-2">
                <span className="text-[10px] data-readout tabular-nums text-muted-foreground/60 w-3 text-right">
                  {i + 1}
                </span>
                <Icon size={11} style={{ color: info.color }} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] truncate data-readout text-foreground/90">
                      {info.label}
                    </span>
                    {lag && (
                      <span className="text-[9px] data-readout tabular-nums text-amber-400/90 flex-shrink-0">
                        {lag}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <span
                      className="block h-full rounded-full bg-primary/60"
                      style={{ width: `${Math.round(lead * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] data-readout tabular-nums text-primary w-5 text-right flex-shrink-0">
                  {row.firsts}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50 data-readout">
        BY PUBLISHER TIMESTAMPS
      </div>
    </div>
  );
}
