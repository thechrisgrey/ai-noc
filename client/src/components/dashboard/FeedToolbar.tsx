import { Search, X, ArrowUpDown, Bookmark, Filter, CheckCheck, Sparkles } from "lucide-react";
import { CATEGORIES, SECTION_FILTERS, type Category, type SectionFilter, type Stats } from "./constants";
import { getSourceMeta } from "./utils";

interface FeedToolbarProps {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchMode: "lexical" | "semantic";
  setSearchMode: (v: "lexical" | "semantic") => void;
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
  onMarkAllRead: () => void;
  feedItemCount: number;
  // Mobile category bar
  stats?: Stats;
  onSelectCategory: (cat: Category) => void;
}

export function FeedToolbar({
  searchQuery,
  setSearchQuery,
  searchMode,
  setSearchMode,
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
  onMarkAllRead,
  feedItemCount,
  stats,
}: FeedToolbarProps) {
  return (
    <div className="flex-shrink-0 px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-3">
      <div className="relative flex-1 max-w-md">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
        />
        <input
          type="search"
          placeholder="Search signals..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-white/[0.08] bg-white/[0.04] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 data-readout"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <button
        onClick={() => setSearchMode(searchMode === "semantic" ? "lexical" : "semantic")}
        disabled={!searchQuery}
        aria-pressed={searchMode === "semantic"}
        title={searchQuery ? "Toggle semantic (meaning-based) search" : "Enter a query to enable semantic search"}
        className={`flex-shrink-0 flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border data-readout transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          searchMode === "semantic" && searchQuery
            ? "bg-primary/15 text-primary border-primary/25"
            : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
        }`}
      >
        <Sparkles size={10} />
        SEMANTIC
      </button>

      <div className="flex items-center gap-2">
        {selectedSource !== "all" && (
          <button
            onClick={() => setSelectedSource("all")}
            className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/25 data-readout hover:bg-primary/20 transition-colors"
          >
            {getSourceMeta(selectedSource).label}
            <X size={10} />
          </button>
        )}
        <button
          onClick={() => setSortMode(sortMode === "time" ? "priority" : "time")}
          aria-pressed={sortMode === "priority"}
          className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg border data-readout transition-colors ${
            sortMode === "priority"
              ? "bg-primary/15 text-primary border-primary/25"
              : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
          }`}
        >
          <ArrowUpDown size={10} />
          {sortMode === "priority" ? "PRIORITY" : "LATEST"}
        </button>
        {(stats?.unreadCount ?? 0) > 0 && (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground data-readout transition-colors"
          >
            <CheckCheck size={10} />
            MARK ALL READ
          </button>
        )}
        {hasActiveFilters && !savingWatchlist && (
          <button
            onClick={() => setSavingWatchlist(true)}
            className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.04] text-primary hover:bg-primary/10 hover:border-primary/25 data-readout transition-colors"
          >
            <Bookmark size={10} />
            SAVE VIEW
          </button>
        )}
        {savingWatchlist && (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Watchlist name..."
              value={watchlistName}
              onChange={(e) => setWatchlistName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSaveWatchlist()}
              className="text-[10px] px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.04] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 data-readout w-32"
              autoFocus
            />
            <button
              onClick={onSaveWatchlist}
              className="text-[10px] px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-medium data-readout transition-all hover:brightness-110"
            >
              SAVE
            </button>
            <button
              onClick={() => { setSavingWatchlist(false); setWatchlistName(""); }}
              aria-label="Cancel saving watchlist"
              className="text-muted-foreground/60 hover:text-foreground"
            >
              <X size={10} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground data-readout tabular-nums">
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
  selectedSection,
  onSelectSection,
}: {
  stats?: Stats;
  selectedCategory: Category;
  showBookmarks: boolean;
  onSelectCategory: (cat: Category) => void;
  selectedSection: SectionFilter;
  onSelectSection: (s: SectionFilter) => void;
}) {
  return (
    <div className="lg:hidden flex-shrink-0 border-b border-white/[0.06]">
      <div className="md:hidden px-3 pt-2 pb-1 overflow-x-auto hide-scrollbar">
        <div className="flex gap-1.5">
          {SECTION_FILTERS.map((s) => {
            const isActive = selectedSection === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onSelectSection(s.value)}
                aria-pressed={isActive}
                aria-label={`Show ${s.label} section`}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.14em] font-medium transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  isActive
                    ? "bg-primary/15 text-primary border-primary/25"
                    : "text-muted-foreground border-transparent hover:bg-white/[0.05] hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="px-3 pb-2 md:pt-2 overflow-x-auto hide-scrollbar">
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
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] uppercase tracking-[0.14em] font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-primary/15 text-primary border-primary/25"
                    : "text-muted-foreground border-transparent hover:bg-white/[0.05] hover:text-foreground"
                }`}
              >
                {cat.shortLabel}
                <span className="data-readout tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
