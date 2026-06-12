import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { useQuery, useInfiniteQuery, useMutation, type InfiniteData } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import { useFeedWebSocket } from "@/hooks/use-feed-websocket";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { Radio, Activity, AlertTriangle, Brain } from "lucide-react";
import * as notifications from "@/lib/notifications";
import { useToast } from "@/hooks/use-toast";

import {
  Header,
  Sidebar,
  FeedToolbar,
  MobileCategoryBar,
  FeedStream,
  IntelPanel,
  BriefingPanel,
  KpiCard,
  getTimeGroup,
  type Category,
  type SectionFilter,
  type FeedItemWithBookmark,
  type Stats,
} from "@/components/dashboard";

// ─── Main Dashboard ──────────────────────────────────────────────

const SignalField = lazy(() => import("@/components/three/SignalField"));

type FeedPage = { items: FeedItemWithBookmark[]; nextCursor: string | null };

export default function Dashboard() {
  // Initialize state from URL params
  const initParams = new URLSearchParams(window.location.search);
  const [selectedCategory, setSelectedCategory] = useState<Category>(
    (initParams.get("category") as Category) || "all",
  );
  const [selectedSource, setSelectedSource] = useState<string>(
    initParams.get("source") || "all",
  );
  const [searchQuery, setSearchQuery] = useState(initParams.get("search") || "");
  const [searchMode, setSearchMode] = useState<"lexical" | "semantic">(
    initParams.get("mode") === "semantic" ? "semantic" : "lexical",
  );
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [newSignals, setNewSignals] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => notifications.isEnabled(),
  );
  const [sortMode, setSortMode] = useState<"time" | "priority">(
    (initParams.get("sort") as "time" | "priority") ||
      (localStorage.getItem("ai-noc-sort") as "time" | "priority") ||
      "time",
  );
  const [selectedSection, setSelectedSection] = useState<SectionFilter>(() => {
    const fromUrl = initParams.get("section");
    if (fromUrl === "ai" || fromUrl === "csp" || fromUrl === "quantum") return fromUrl;
    const stored = localStorage.getItem("ai-noc-section");
    if (stored === "ai" || stored === "csp" || stored === "quantum") return stored;
    return "all";
  });
  const [savingWatchlist, setSavingWatchlist] = useState(false);
  const [watchlistName, setWatchlistName] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 300);
  const { toast } = useToast();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Semantic search is only meaningful with a non-empty query.
  const isSemantic = searchMode === "semantic" && debouncedSearch !== "";

  // ── URL sync ──
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (selectedSource !== "all") params.set("source", selectedSource);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (sortMode !== "time") params.set("sort", sortMode);
    if (isSemantic) params.set("mode", "semantic");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [selectedCategory, selectedSource, debouncedSearch, sortMode, isSemantic]);

  useEffect(() => {
    localStorage.setItem("ai-noc-sort", sortMode);
  }, [sortMode]);

  // ── WebSocket ──
  const wsCallbacks = useMemo(() => ({
    onNewItems: (count: number) => setNewSignals((prev) => prev + count),
    onAlert: (items: { id: number; title: string; sourceLabel: string; priority: number }[]) => {
      if (notifications.isEnabled() && document.hidden) {
        for (const item of items) {
          notifications.sendNotification(
            `[P${item.priority}] ${item.sourceLabel}`,
            item.title,
            () => {
              window.focus();
              queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
              queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
            },
          );
        }
      }
    },
    onWatchlistHit: (hit: { watchlistId: number; name: string; items: { id: number; title: string; sourceLabel: string }[] }) => {
      const first = hit.items[0];
      const description = first?.title ?? `${hit.items.length} new signals`;
      toast({ title: `WATCHLIST: ${hit.name}`, description });
      if (notifications.isEnabled() && document.hidden && first) {
        notifications.sendNotification(
          `WATCHLIST: ${hit.name}`,
          first.title,
          () => {
            window.focus();
            queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
            queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
          },
        );
      }
    },
  }), [toast]);
  useFeedWebSocket(wsCallbacks);

  // ── Queries ──
  const {
    data: feedData,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<FeedPage>({
    queryKey: ["/api/feed", selectedCategory, selectedSource, debouncedSearch, sortMode, isSemantic],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (selectedSource !== "all") params.set("source", selectedSource);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (sortMode !== "time") params.set("sort", sortMode);
      if (isSemantic) params.set("mode", "semantic");
      // Semantic results come as a single distance-ranked page (nextCursor null).
      if (pageParam && !isSemantic) params.set("cursor", pageParam as string);
      params.set("limit", "30");
      const res = await apiRequest("GET", `/api/feed?${params.toString()}`);
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 0) <= 3 ? 60000 : false,
  });

  // Priority recompute shifts keyset cursors between page fetches, so
  // adjacent pages can briefly overlap; dedupe by id across the seam.
  const feedItems: FeedItemWithBookmark[] = useMemo(() => {
    const seen = new Set<number>();
    const items: FeedItemWithBookmark[] = [];
    for (const item of feedData?.pages.flatMap((p) => p.items) ?? []) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
    return items;
  }, [feedData]);

  const { data: stats, isError: statsError } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    refetchInterval: 30000,
  });

  const { data: bookmarksList = [] } = useQuery<any[]>({
    queryKey: ["/api/bookmarks"],
  });

  const { data: watchlistsData = [] } = useQuery<any[]>({
    queryKey: ["/api/watchlists"],
  });

  // Infinite scroll observer
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Mutations ──
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/feed/refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: () => {
      toast({ title: "SYNC FAILED", description: "Could not refresh feeds. Try again.", variant: "destructive" });
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async ({ feedItemId, isBookmarked }: { feedItemId: number; isBookmarked: boolean }) => {
      if (isBookmarked) {
        await apiRequest("DELETE", `/api/bookmarks/${feedItemId}`);
      } else {
        try {
          await apiRequest("POST", "/api/bookmarks", { feedItemId });
        } catch (err) {
          // 409 means the server already agrees with the optimistic state;
          // rolling back would desync the feed cache from the server.
          if (!(err instanceof Error && err.message.startsWith("409:"))) {
            throw err;
          }
        }
      }
    },
    onMutate: async ({ feedItemId }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/feed"] });
      const snapshots = queryClient.getQueriesData<InfiniteData<FeedPage>>({ queryKey: ["/api/feed"] });
      queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ["/api/feed"] }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === feedItemId ? { ...item, isBookmarked: !item.isBookmarked } : item,
            ),
          })),
        };
      });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      for (const [queryKey, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      toast({ title: "BOOKMARK FAILED", description: "Could not save bookmark. Try again.", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await apiRequest("POST", "/api/items/read", { ids });
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ["/api/feed"] });
      const snapshots = queryClient.getQueriesData<InfiniteData<FeedPage>>({ queryKey: ["/api/feed"] });
      const readAt = new Date().toISOString();
      const idSet = new Set(ids);
      queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ["/api/feed"] }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              idSet.has(item.id) && !item.readAt ? { ...item, readAt } : item,
            ),
          })),
        };
      });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      for (const [queryKey, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async (before: string) => {
      await apiRequest("POST", "/api/feed/read-all", { before });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: () => {
      toast({ title: "MARK READ FAILED", description: "Could not mark signals read. Try again.", variant: "destructive" });
    },
  });

  const createWatchlistMutation = useMutation({
    mutationFn: async (body: { name: string; category?: string; source?: string; search?: string; sort?: string }) => {
      const res = await apiRequest("POST", "/api/watchlists", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlists"] });
      setSavingWatchlist(false);
      setWatchlistName("");
      toast({ title: "WATCHLIST SAVED", description: "View saved to watchlists." });
    },
    onError: () => {
      toast({ title: "SAVE FAILED", description: "Could not save watchlist.", variant: "destructive" });
    },
  });

  const deleteWatchlistMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/watchlists/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlists"] });
    },
  });

  const toggleWatchlistAlertMutation = useMutation({
    mutationFn: async ({ id, alert }: { id: number; alert: boolean }) => {
      await apiRequest("PATCH", `/api/watchlists/${id}`, { alert });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlists"] });
    },
    onError: () => {
      toast({ title: "ALERT TOGGLE FAILED", description: "Could not update watchlist alerts.", variant: "destructive" });
    },
  });

  // ── Derived ──
  const hasActiveFilters =
    selectedCategory !== "all" ||
    selectedSource !== "all" ||
    searchQuery !== "" ||
    sortMode !== "time";

  const breakingItems = feedItems.filter((i) => i.isBreaking);

  const groupedItems = useMemo(() => {
    if (sortMode === "priority") return [];
    const order = ["TODAY", "YESTERDAY", "THIS WEEK", "EARLIER"];
    const map: Record<string, FeedItemWithBookmark[]> = {};
    for (const item of feedItems) {
      const g = getTimeGroup(item.publishedAt);
      (map[g] ??= []).push(item);
    }
    return order
      .filter((l) => map[l]?.length)
      .map((label) => ({ label, items: map[label] }));
  }, [feedItems, sortMode]);

  const sourceCount = Object.keys(stats?.bySource || {}).length;

  // ── Handlers ──
  const handleToggleBookmark = useCallback((id: number, isBookmarked: boolean) => {
    bookmarkMutation.mutate({ feedItemId: id, isBookmarked });
  }, [bookmarkMutation]);

  const handleMarkRead = useCallback((id: number) => {
    markReadMutation.mutate([id]);
  }, [markReadMutation]);

  const handleMarkAllRead = useCallback(() => {
    if (feedItems.length === 0) return;
    const newest = feedItems.reduce(
      (max, item) => (item.publishedAt > max ? item.publishedAt : max),
      feedItems[0].publishedAt,
    );
    markAllReadMutation.mutate(newest);
  }, [feedItems, markAllReadMutation]);

  const handleSelectCategory = useCallback((cat: Category) => {
    setSelectedCategory(cat);
    setShowBookmarks(false);
  }, []);

  const handleSelectSection = useCallback((s: SectionFilter) => {
    setSelectedSection(s);
    setShowBookmarks(false);
  }, []);

  const handleSelectSource = useCallback((source: string) => {
    setSelectedSource((prev) => prev === source ? "all" : source);
    setShowBookmarks(false);
  }, []);

  const handleSaveWatchlist = useCallback(() => {
    if (!watchlistName.trim()) return;
    createWatchlistMutation.mutate({
      name: watchlistName.trim(),
      category: selectedCategory !== "all" ? selectedCategory : undefined,
      source: selectedSource !== "all" ? selectedSource : undefined,
      search: searchQuery || undefined,
      sort: sortMode !== "time" ? sortMode : undefined,
    });
  }, [watchlistName, selectedCategory, selectedSource, searchQuery, sortMode, createWatchlistMutation]);

  const handleApplyWatchlist = useCallback((wl: any) => {
    setSelectedCategory(wl.category || "all");
    setSelectedSource(wl.source || "all");
    setSearchQuery(wl.search || "");
    setSortMode(wl.sort || "time");
    setShowBookmarks(false);
  }, []);

  const handleDismissNewSignals = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    setNewSignals(0);
  }, []);

  // ── Keyboard navigation ──
  const handleNavSelect = useCallback((item: FeedItemWithBookmark) => {
    setSelectedItemId(item.id);
    if (!item.readAt) markReadMutation.mutate([item.id]);
  }, [markReadMutation]);

  const handleNavOpen = useCallback((item: FeedItemWithBookmark) => {
    if (item.url) window.open(item.url, "_blank", "noopener");
  }, []);

  const handleNavBookmark = useCallback((item: FeedItemWithBookmark) => {
    bookmarkMutation.mutate({ feedItemId: item.id, isBookmarked: item.isBookmarked });
  }, [bookmarkMutation]);

  const handleNavClear = useCallback(() => {
    setSelectedItemId(null);
  }, []);

  useKeyboardNav({
    items: feedItems,
    selectedId: selectedItemId,
    onSelect: handleNavSelect,
    onOpen: handleNavOpen,
    onBookmark: handleNavBookmark,
    onClear: handleNavClear,
    enabled: !showBookmarks,
  });

  // ── Render ──
  return (
    <div className="h-screen flex flex-col scanlines grid-bg">
      <Suspense fallback={null}>
        <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
          <SignalField />
        </div>
      </Suspense>

      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        <Header
          stats={stats}
          showBookmarks={showBookmarks}
          setShowBookmarks={setShowBookmarks}
          notificationsEnabled={notificationsEnabled}
          setNotificationsEnabled={setNotificationsEnabled}
          refreshMutation={refreshMutation}
          bookmarksCount={bookmarksList.length}
          selectedSection={selectedSection}
          onSelectSection={handleSelectSection}
        />

        <MobileCategoryBar
          stats={stats}
          selectedCategory={selectedCategory}
          showBookmarks={showBookmarks}
          onSelectCategory={handleSelectCategory}
          selectedSection={selectedSection}
          onSelectSection={handleSelectSection}
        />

        <div className="flex-1 flex overflow-hidden">
          <Sidebar
            stats={stats}
            selectedCategory={selectedCategory}
            selectedSource={selectedSource}
            showBookmarks={showBookmarks}
            watchlistsData={watchlistsData}
            onSelectCategory={handleSelectCategory}
            onSelectSource={handleSelectSource}
            onApplyWatchlist={handleApplyWatchlist}
            onToggleWatchlistAlert={(id, alert) => toggleWatchlistAlertMutation.mutate({ id, alert })}
            onDeleteWatchlist={(id) => deleteWatchlistMutation.mutate(id)}
          />

          <div className="flex-1 flex flex-col overflow-hidden">
            <BriefingPanel />

            {/* KPI Row */}
            <div className="flex-shrink-0 px-5 py-4 border-b border-white/[0.04]">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard
                  label="TOTAL SIGNALS"
                  value={statsError ? "--" : stats?.total || 0}
                  icon={Radio}
                  color="hsl(68,96%,58%)"
                  sub={!statsError && (stats?.unreadCount ?? 0) > 0 ? `${stats!.unreadCount} UNREAD` : undefined}
                />
                <KpiCard label="HIGH PRIORITY" value={statsError ? "--" : stats?.breakingCount || 0} icon={AlertTriangle} color="hsl(5,80%,62%)" />
                <KpiCard label="MODEL RELEASES" value={statsError ? "--" : stats?.byCategory?.model_release || 0} icon={Brain} color="hsl(68,95%,60%)" />
                <KpiCard label="SOURCES ACTIVE" value={statsError ? "--" : sourceCount} icon={Activity} color="hsl(150,60%,55%)" />
              </div>
            </div>

            <FeedToolbar
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchMode={searchMode}
              setSearchMode={setSearchMode}
              sortMode={sortMode}
              setSortMode={setSortMode}
              selectedCategory={selectedCategory}
              selectedSource={selectedSource}
              setSelectedSource={setSelectedSource}
              showBookmarks={showBookmarks}
              hasActiveFilters={hasActiveFilters}
              savingWatchlist={savingWatchlist}
              setSavingWatchlist={setSavingWatchlist}
              watchlistName={watchlistName}
              setWatchlistName={setWatchlistName}
              onSaveWatchlist={handleSaveWatchlist}
              onMarkAllRead={handleMarkAllRead}
              feedItemCount={feedItems.length}
              stats={stats}
              onSelectCategory={handleSelectCategory}
            />

            <FeedStream
              feedItems={feedItems}
              isLoading={isLoading}
              isError={isError}
              onRetry={refetch}
              showBookmarks={showBookmarks}
              sortMode={sortMode}
              groupedItems={groupedItems}
              breakingItems={breakingItems}
              bookmarksList={bookmarksList}
              loadMoreRef={loadMoreRef}
              isFetchingNextPage={isFetchingNextPage}
              newSignals={newSignals}
              onDismissNewSignals={handleDismissNewSignals}
              onToggleBookmark={handleToggleBookmark}
              onMarkRead={handleMarkRead}
              selectedItemId={selectedItemId}
            />
          </div>

          <IntelPanel stats={stats} feedItems={feedItems} />
        </div>
      </div>
    </div>
  );
}
