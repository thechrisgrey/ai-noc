import { X } from "lucide-react";
import { CATEGORIES, type Category, type Stats } from "./constants";
import { getSourceMeta } from "./utils";

interface SidebarProps {
  stats?: Stats;
  selectedCategory: Category;
  selectedSource: string;
  showBookmarks: boolean;
  watchlistsData: any[];
  onSelectCategory: (cat: Category) => void;
  onSelectSource: (source: string) => void;
  onApplyWatchlist: (wl: any) => void;
  onDeleteWatchlist: (id: number) => void;
}

export function Sidebar({
  stats,
  selectedCategory,
  selectedSource,
  showBookmarks,
  watchlistsData,
  onSelectCategory,
  onSelectSource,
  onApplyWatchlist,
  onDeleteWatchlist,
}: SidebarProps) {
  return (
    <nav className="hidden lg:flex lg:flex-col w-52 flex-shrink-0 border-r border-sidebar-border bg-sidebar overflow-y-auto">
      {/* Categories */}
      <div className="p-3 space-y-0.5">
        <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-2 px-2 data-readout">
          CATEGORIES
        </div>
        {CATEGORIES.map((cat) => {
          const CatIcon = cat.icon;
          const count =
            cat.value === "all"
              ? stats?.total || 0
              : stats?.byCategory?.[cat.value] || 0;
          const isActive =
            selectedCategory === cat.value && !showBookmarks;
          return (
            <button
              key={cat.value}
              onClick={() => onSelectCategory(cat.value)}
              aria-current={isActive ? "true" : undefined}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all ${
                isActive
                  ? "bg-primary/[0.12] text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.05] border border-transparent"
              }`}
            >
              <CatIcon
                size={14}
                style={isActive ? { color: cat.color } : undefined}
              />
              <span className="flex-1 text-left tracking-[0.14em] uppercase text-[10px] font-medium">
                {cat.label}
              </span>
              <span className="data-readout text-[10px] tabular-nums text-right opacity-60">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sources */}
      <div className="p-3 space-y-0.5 border-t border-white/[0.06] flex-1">
        <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-2 px-2 data-readout">
          SOURCES
        </div>
        {Object.entries(stats?.bySource || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 14)
          .map(([source, count]) => {
            const info = getSourceMeta(source);
            const SrcIcon = info.icon;
            const isActive = selectedSource === source;
            return (
              <button
                key={source}
                onClick={() => onSelectSource(source)}
                aria-current={isActive ? "true" : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] transition-all ${
                  isActive
                    ? "bg-primary/[0.12] border border-primary/20"
                    : "border border-transparent hover:bg-white/[0.05]"
                }`}
              >
                <SrcIcon size={11} style={{ color: info.color }} />
                <span
                  className={`flex-1 truncate text-left ${
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {info.label}
                </span>
                <span className="data-readout tabular-nums text-right opacity-60">{count}</span>
              </button>
            );
          })}
      </div>

      {/* Watchlists */}
      {watchlistsData.length > 0 && (
        <div className="p-3 space-y-0.5 border-t border-white/[0.06]">
          <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground mb-2 px-2 data-readout">
            WATCHLISTS
          </div>
          {watchlistsData.map((wl: any) => (
            <div
              key={wl.id}
              className="group flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/[0.05] cursor-pointer transition-all"
            >
              <button
                onClick={() => onApplyWatchlist(wl)}
                className="flex-1 text-left truncate"
              >
                {wl.name}
              </button>
              <button
                onClick={() => onDeleteWatchlist(wl.id)}
                aria-label={`Delete watchlist ${wl.name}`}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus:opacity-100 text-muted-foreground/60 hover:text-destructive transition-all"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
