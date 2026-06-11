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
    <nav className="hidden lg:flex lg:flex-col w-52 flex-shrink-0 border-r border-border/50 bg-sidebar overflow-y-auto">
      {/* Categories */}
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2 px-2 data-readout">
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
              className={`w-full flex items-center gap-2 px-2 py-2 rounded text-xs transition-all ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/50 border border-transparent"
              }`}
            >
              <CatIcon
                size={14}
                style={isActive ? { color: cat.color } : undefined}
              />
              <span className="flex-1 text-left tracking-wider uppercase text-[10px] font-medium">
                {cat.label}
              </span>
              <span className="data-readout text-[10px] opacity-50">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sources */}
      <div className="p-3 border-t border-border/20 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2 px-2 data-readout">
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
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] transition-all ${
                  isActive
                    ? "bg-primary/10 border border-primary/20"
                    : "border border-transparent hover:bg-card/50"
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
                <span className="data-readout opacity-40">{count}</span>
              </button>
            );
          })}
      </div>

      {/* Watchlists */}
      {watchlistsData.length > 0 && (
        <div className="p-3 border-t border-border/20">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-2 px-2 data-readout">
            WATCHLISTS
          </div>
          {watchlistsData.map((wl: any) => (
            <div
              key={wl.id}
              className="group flex items-center gap-1 px-2 py-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-card/50 cursor-pointer transition-all"
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
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus:opacity-100 text-muted-foreground/40 hover:text-red-400 transition-all"
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
