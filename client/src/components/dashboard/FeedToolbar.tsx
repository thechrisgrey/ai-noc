import { Search, X, ArrowUpDown, Bookmark, Filter } from "lucide-react";
import { CATEGORIES, type Category, type Stats } from "./constants";
import { getSourceMeta } from "./utils";

interface FeedToolbarProps {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  sortMode: "time" | "priority";
  setSortMode: (v: "time" | "priority") => void;
  selectedCategory: Category;
  selectedSource: string;
  setSelectedSource: (v: string) => void;
  showBookmarks: boolean;
  hasActiveFilters: boolean;
  savingWatchlist: boolean;
  setSavingWatchlist: (v: boolean) => void;
  watchlistName: string;
  setWatchlistName: (v: string) => void;
  onSaveWatchlist: () => void;
  feedItemCount: number;
  // Mobile category bar
  stats?: Stats;
  onSelectCategory: (cat: Category) => void;
}

export function FeedToolbar({
  searchQuery,
  setSearchQuery,
  sortMode,
  setSortMode,
  selectedSource,
  setSelectedSource,
  hasActiveFilters,
  savingWatchlist,
  setSavingWatchlist,
  watchlistName,
  setWatchlistName,
  onSaveWatchlist,
  feedItemCount,
}: FeedToolbarProps) {
  return (
    <div className="flex-shrink-0 px-4 py-2 border-b border-border/20 flex items-center gap-3">
      <div className="relative flex-1 max-w-md">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40"
        />
        <input
          type="search"
          placeholder="Search signals..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-8 py-1.5 text-xs rounded border border-border/40 bg-card/20 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 data-readout"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {selectedSource !== "all" && (
          <button
            onClick={() => setSelectedSource("all")}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 data-readout hover:bg-primary/15 transition-colors"
          >
            {getSourceMeta(selectedSource).label}
            <X size={10} />
          </button>
        )}
        <button
          onClick={() => setSortMode(sortMode === "time" ? "priority" : "time")}
          aria-pressed={sortMode === "priority"}
          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border data-readout transition-colors ${
            sortMode === "priority"
              ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
              : "text-muted-foreground/50 border-border/30 hover:text-foreground"
          }`}
        >
          <ArrowUpDown size={10} />
          {sortMode === "priority" ? "PRIORITY" : "LATEST"}
        </button>
        {hasActiveFilters && !savingWatchlist && (
          <button
            onClick={() => setSavingWatchlist(true)}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-primary/20 text-primary/60 hover:text-primary hover:bg-primary/10 data-readout transition-colors"
          >
            <Bookmark size={10} />
            SAVE VIEW
          </button>
        )}
        {savingWatchlist && (
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="Watchlist name..."
              value={watchlistName}
              onChange={(e) => setWatchlistName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSaveWatchlist()}
              className="text-[10px] px-2 py-1 rounded border border-primary/30 bg-card/30 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 data-readout w-32"
              autoFocus
            />
            <button
              onClick={onSaveWatchlist}
              className="text-[10px] px-2 py-1 rounded bg-primary/20 text-primary data-readout hover:bg-primary/30"
            >
              SAVE
            </button>
            <button
              onClick={() => { setSavingWatchlist(false); setWatchlistName(""); }}
              className="text-muted-foreground/40 hover:text-foreground"
            >
              <X size={10} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40 data-readout">
          <Filter size={10} />
          <span>{feedItemCount} signals</span>
        </div>
      </div>
    </div>
  );
}

export function MobileCategoryBar({
  stats,
  selectedCategory,
  showBookmarks,
  onSelectCategory,
}: {
  stats?: Stats;
  selectedCategory: Category;
  showBookmarks: boolean;
  onSelectCategory: (cat: Category) => void;
}) {
  return (
    <div className="lg:hidden flex-shrink-0 border-b border-border/30 px-3 py-2 overflow-x-auto hide-scrollbar bg-card/20">
      <div className="flex gap-1.5">
        {CATEGORIES.map((cat) => {
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
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] uppercase tracking-wider font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "bg-primary/15 text-primary border border-primary/25"
                  : "text-muted-foreground border border-border/30 hover:text-foreground"
              }`}
            >
              {cat.shortLabel}
              <span className="data-readout opacity-50">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
