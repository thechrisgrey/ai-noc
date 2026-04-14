import React, { type RefObject } from "react";
import { Radio, Bookmark, BookmarkCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { type FeedItemWithBookmark } from "./constants";
import { FeedCard } from "./FeedCard";
import { getSourceMeta } from "./utils";

interface FeedStreamProps {
  feedItems: FeedItemWithBookmark[];
  isLoading: boolean;
  showBookmarks: boolean;
  sortMode: "time" | "priority";
  groupedItems: { label: string; items: FeedItemWithBookmark[] }[];
  breakingItems: FeedItemWithBookmark[];
  bookmarksList: any[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isFetchingNextPage: boolean;
  newSignals: number;
  onDismissNewSignals: () => void;
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
}

export function FeedStream({
  feedItems,
  isLoading,
  showBookmarks,
  sortMode,
  groupedItems,
  breakingItems,
  bookmarksList,
  loadMoreRef,
  isFetchingNextPage,
  newSignals,
  onDismissNewSignals,
  onToggleBookmark,
}: FeedStreamProps) {
  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Live update notification */}
      {newSignals > 0 && (
        <button
          onClick={onDismissNewSignals}
          className="flex-shrink-0 px-4 py-2 border-b border-primary/20 bg-primary/5 flex items-center justify-center gap-2 text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer data-readout"
        >
          <Radio size={12} className="status-pulse" />
          {newSignals} new signal{newSignals !== 1 ? "s" : ""} detected
          -- click to load
        </button>
      )}

      {/* Breaking Ticker */}
      {breakingItems.length > 0 && !showBookmarks && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-red-500/15 bg-red-950/10">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex-shrink-0 flex items-center gap-1 text-red-400/80 font-semibold uppercase tracking-wider text-[10px]">
              <AlertTriangle size={11} className="status-pulse" />
              BREAKING
            </span>
            <div className="flex-1 overflow-hidden">
              <div className="flex whitespace-nowrap animate-marquee">
                {[...breakingItems, ...breakingItems].map((item, idx) => (
                  <span
                    key={`${item.id}-${idx}`}
                    className="inline-flex items-center mr-8"
                  >
                    <span
                      className="font-medium"
                      style={{
                        color: getSourceMeta(item.source).color,
                      }}
                    >
                      {item.sourceLabel}
                    </span>
                    <span className="mx-2 text-muted-foreground/40">
                      :
                    </span>
                    <span className="text-muted-foreground/70">
                      {item.title}
                    </span>
                    <span className="text-border/30 mx-4">|</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feed Stream */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ overscrollBehavior: "contain" }}
      >
        {isLoading ? (
          <LoadingSkeleton />
        ) : showBookmarks ? (
          <BookmarksView
            bookmarksList={bookmarksList}
            onToggleBookmark={onToggleBookmark}
          />
        ) : sortMode === "priority" ? (
          <PriorityList
            feedItems={feedItems}
            loadMoreRef={loadMoreRef}
            isFetchingNextPage={isFetchingNextPage}
            onToggleBookmark={onToggleBookmark}
          />
        ) : (
          <GroupedList
            groupedItems={groupedItems}
            feedItems={feedItems}
            loadMoreRef={loadMoreRef}
            isFetchingNextPage={isFetchingNextPage}
            onToggleBookmark={onToggleBookmark}
          />
        )}
      </div>
    </main>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="border border-border/30 rounded bg-card/20 px-4 py-3 border-l-[3px] border-l-border/20"
        >
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded skeleton-shimmer" />
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="h-3 w-16 rounded skeleton-shimmer" />
                <div className="h-3 w-14 rounded skeleton-shimmer" />
              </div>
              <div className="h-4 w-4/5 rounded skeleton-shimmer" />
              <div className="h-3 w-3/5 rounded skeleton-shimmer" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BookmarksView({
  bookmarksList,
  onToggleBookmark,
}: {
  bookmarksList: any[];
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-3 flex items-center gap-1.5 data-readout">
        <BookmarkCheck size={12} />
        SAVED SIGNALS ({bookmarksList.length})
      </div>
      {bookmarksList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Bookmark size={28} className="mb-3 opacity-20" />
          <p className="text-sm opacity-60">No saved signals</p>
          <p className="text-xs mt-1 opacity-30">
            Bookmark items to track them here
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {bookmarksList.map(
            (bm: any) =>
              bm.feedItem && (
                <FeedCard
                  key={bm.id}
                  item={{ ...bm.feedItem, isBookmarked: true }}
                  onToggleBookmark={onToggleBookmark}
                />
              ),
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Radio size={28} className="mb-3 opacity-20" />
      <p className="text-sm opacity-60">No signals detected</p>
      <p className="text-xs mt-1 opacity-30">
        Try adjusting your filters or sync feeds
      </p>
    </div>
  );
}

function InfiniteScrollSentinel({
  loadMoreRef,
  isFetchingNextPage,
}: {
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isFetchingNextPage: boolean;
}) {
  return (
    <>
      <div ref={loadMoreRef as React.Ref<HTMLDivElement>} className="h-4" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground/40 data-readout gap-2">
          <RefreshCw size={12} className="animate-spin" />
          Loading more signals...
        </div>
      )}
    </>
  );
}

function PriorityList({
  feedItems,
  loadMoreRef,
  isFetchingNextPage,
  onToggleBookmark,
}: {
  feedItems: FeedItemWithBookmark[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isFetchingNextPage: boolean;
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      {feedItems.map((item, i) => (
        <div
          key={item.id}
          className="feed-enter"
          style={{ animationDelay: `${Math.min(i * 25, 200)}ms` }}
        >
          <FeedCard item={item} onToggleBookmark={onToggleBookmark} />
        </div>
      ))}
      {feedItems.length === 0 && <EmptyState />}
      <InfiniteScrollSentinel
        loadMoreRef={loadMoreRef}
        isFetchingNextPage={isFetchingNextPage}
      />
    </div>
  );
}

function GroupedList({
  groupedItems,
  feedItems,
  loadMoreRef,
  isFetchingNextPage,
  onToggleBookmark,
}: {
  groupedItems: { label: string; items: FeedItemWithBookmark[] }[];
  feedItems: FeedItemWithBookmark[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isFetchingNextPage: boolean;
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      {groupedItems.map((group) => (
        <div key={group.label}>
          <div className="flex items-center gap-3 py-1.5 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 data-readout font-medium">
              {group.label}
            </span>
            <div className="flex-1 h-px bg-border/15" />
            <span className="text-[10px] text-muted-foreground/30 data-readout">
              {group.items.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {group.items.map((item, i) => (
              <div
                key={item.id}
                className="feed-enter"
                style={{
                  animationDelay: `${Math.min(i * 25, 200)}ms`,
                }}
              >
                <FeedCard item={item} onToggleBookmark={onToggleBookmark} />
              </div>
            ))}
          </div>
        </div>
      ))}
      {feedItems.length === 0 && <EmptyState />}
      <InfiniteScrollSentinel
        loadMoreRef={loadMoreRef}
        isFetchingNextPage={isFetchingNextPage}
      />
    </div>
  );
}
