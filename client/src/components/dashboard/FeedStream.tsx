import React, { type RefObject } from "react";
import { Radio, Bookmark, BookmarkCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { type FeedItemWithBookmark } from "./constants";
import { FeedCard } from "./FeedCard";
import { getSourceMeta } from "./utils";

interface FeedStreamProps {
  feedItems: FeedItemWithBookmark[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
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
  onMarkRead: (id: number) => void;
  selectedItemId: number | null;
}

export function FeedStream({
  feedItems,
  isLoading,
  isError,
  onRetry,
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
  onMarkRead,
  selectedItemId,
}: FeedStreamProps) {
  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Live update notification */}
      {newSignals > 0 && (
        <div className="flex-shrink-0 flex justify-center px-4 py-2">
          <button
            onClick={onDismissNewSignals}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] text-primary bg-primary/15 border border-primary/25 hover:bg-primary/20 transition-colors cursor-pointer data-readout shadow-[0_0_16px_hsla(68,96%,58%,0.15)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Radio size={12} className="status-pulse" />
            {newSignals} new signal{newSignals !== 1 ? "s" : ""} detected
            -- click to load
          </button>
        </div>
      )}

      {/* Breaking Ticker */}
      {breakingItems.length > 0 && !showBookmarks && (
        <div className="flex-shrink-0 px-4 pt-3">
          <div className="rounded-lg border border-red-500/15 bg-red-500/10 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex-shrink-0 flex items-center gap-1.5 text-red-400 font-semibold uppercase tracking-[0.14em] text-[10px]">
                <AlertTriangle size={11} className="status-pulse" />
                BREAKING
              </span>
              <div className="flex-1 overflow-hidden">
                <div className="flex whitespace-nowrap animate-marquee">
                  {[...breakingItems, ...breakingItems].map((item, idx) => (
                    <span
                      key={`${item.id}-${idx}`}
                      aria-hidden={idx >= breakingItems.length || undefined}
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
                      <span className="text-muted-foreground">
                        {item.title}
                      </span>
                      <span className="text-white/[0.12] mx-4">|</span>
                    </span>
                  ))}
                </div>
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
            onMarkRead={onMarkRead}
          />
        ) : isError ? (
          <ErrorState onRetry={onRetry} />
        ) : sortMode === "priority" ? (
          <PriorityList
            feedItems={feedItems}
            loadMoreRef={loadMoreRef}
            isFetchingNextPage={isFetchingNextPage}
            onToggleBookmark={onToggleBookmark}
            onMarkRead={onMarkRead}
            selectedItemId={selectedItemId}
          />
        ) : (
          <GroupedList
            groupedItems={groupedItems}
            feedItems={feedItems}
            loadMoreRef={loadMoreRef}
            isFetchingNextPage={isFetchingNextPage}
            onToggleBookmark={onToggleBookmark}
            onMarkRead={onMarkRead}
            selectedItemId={selectedItemId}
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
          className="rounded-xl border border-white/[0.06] bg-card px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg skeleton-shimmer" />
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="h-3 w-16 rounded-full skeleton-shimmer" />
                <div className="h-3 w-14 rounded-full skeleton-shimmer" />
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
  onMarkRead,
}: {
  bookmarksList: any[];
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
  onMarkRead: (id: number) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] font-medium text-amber-400/90 mb-3 flex items-center gap-1.5 data-readout">
        <BookmarkCheck size={12} />
        SAVED SIGNALS ({bookmarksList.length})
      </div>
      {bookmarksList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center mb-4">
            <Bookmark size={18} className="text-muted-foreground/60" />
          </div>
          <p className="text-sm text-foreground/80">No saved signals</p>
          <p className="text-xs mt-1 text-muted-foreground">
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
                  onMarkRead={onMarkRead}
                />
              ),
          )}
        </div>
      )}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex flex-col items-center px-10 py-8 rounded-2xl border border-destructive/25 bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.5)]">
        <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center mb-4">
          <AlertTriangle size={20} className="text-destructive" />
        </div>
        <p className="text-xs uppercase tracking-[0.14em] text-destructive font-semibold data-readout">
          SIGNAL LINK DOWN
        </p>
        <p className="text-xs mt-1.5 text-muted-foreground">
          Feed unavailable -- check connection
        </p>
        <button
          onClick={onRetry}
          className="mt-5 flex items-center gap-1.5 text-[10px] tracking-[0.14em] px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-foreground hover:bg-white/[0.07] data-readout transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <RefreshCw size={10} />
          RETRY
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center mb-4">
        <Radio size={18} className="text-muted-foreground/60" />
      </div>
      <p className="text-sm text-foreground/80">No signals detected</p>
      <p className="text-xs mt-1 text-muted-foreground">
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
        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground/60 data-readout gap-2">
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
  onMarkRead,
  selectedItemId,
}: {
  feedItems: FeedItemWithBookmark[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isFetchingNextPage: boolean;
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
  onMarkRead: (id: number) => void;
  selectedItemId: number | null;
}) {
  return (
    <div className="space-y-1.5">
      {feedItems.map((item, i) => (
        <div
          key={item.id}
          className="feed-enter"
          style={{ animationDelay: `${Math.min(i * 25, 200)}ms` }}
        >
          <FeedCard
            item={item}
            onToggleBookmark={onToggleBookmark}
            onMarkRead={onMarkRead}
            isSelected={item.id === selectedItemId}
          />
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
  onMarkRead,
  selectedItemId,
}: {
  groupedItems: { label: string; items: FeedItemWithBookmark[] }[];
  feedItems: FeedItemWithBookmark[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isFetchingNextPage: boolean;
  onToggleBookmark: (id: number, isBookmarked: boolean) => void;
  onMarkRead: (id: number) => void;
  selectedItemId: number | null;
}) {
  return (
    <div className="space-y-4">
      {groupedItems.map((group) => (
        <div key={group.label}>
          <div className="flex items-center gap-3 py-1.5 mb-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground data-readout font-medium">
              {group.label}
            </span>
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-[10px] text-muted-foreground/60 data-readout tabular-nums">
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
                <FeedCard
                  item={item}
                  onToggleBookmark={onToggleBookmark}
                  onMarkRead={onMarkRead}
                  isSelected={item.id === selectedItemId}
                />
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
