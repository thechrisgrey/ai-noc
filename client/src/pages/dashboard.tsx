import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import { useFeedWebSocket } from "@/hooks/use-feed-websocket";
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
  type FeedItemWithBookmark,
  type Stats,
} from "@/components/dashboard";

// ─── Main Dashboard ──────────────────────────────────────────────

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
  const [savingWatchlist, setSavingWatchlist] = useState(false);
  const [watchlistName, setWatchlistName] = useState("");

  const debouncedSearch = useDebounce(searchQuery, 300);
  const { toast } = useToast();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // ── URL sync ──
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (selectedSource !== "all") params.set("source", selectedSource);
    if (searchQuery) params.set("search", searchQuery);
    if (sortMode !== "time") params.set("sort", sortMode);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [selectedCategory, selectedSource, searchQuery, sortMode]);

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
  }), []);
  useFeedWebSocket(wsCallbacks);

  // ── Queries ──
  const {
    data: feedData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<FeedPage>({
    queryKey: ["/api/feed", selectedCategory, selectedSource, debouncedSearch, sortMode],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (selectedSource !== "all") params.set("source", selectedSource);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (sortMode !== "time") params.set("sort", sortMode);
      if (pageParam) params.set("cursor", pageParam as string);
      params.set("limit", "30");
      const res = await apiRequest("GET", `/api/feed?${params.toString()}`);
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    refetchInterval: 60000,
  });

  const feedItems: FeedItemWithBookmark[] = useMemo(
    () => feedData?.pages.flatMap((p) => p.items) ?? [],
    [feedData],
  );

  const { data: stats } = useQuery<Stats>({
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
        await apiRequest("POST", "/api/bookmarks", { feedItemId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    },
    onError: () => {
      toast({ title: "BOOKMARK FAILED", description: "Could not save bookmark. Try again.", variant: "destructive" });
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

  const handleSelectCategory = useCallback((cat: Category) => {
    setSelectedCategory(cat);
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

  // ── Render ──
  return (
    <div className="h-screen flex flex-col scanlines grid-bg">
      <Header
        stats={stats}
        showBookmarks={showBookmarks}
        setShowBookmarks={setShowBookmarks}
        notificationsEnabled={notificationsEnabled}
        setNotificationsEnabled={setNotificationsEnabled}
        refreshMutation={refreshMutation}
        bookmarksCount={bookmarksList.length}
      />

      <MobileCategoryBar
        stats={stats}
        selectedCategory={selectedCategory}
        showBookmarks={showBookmarks}
        onSelectCategory={handleSelectCategory}
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
          onDeleteWatchlist={(id) => deleteWatchlistMutation.mutate(id)}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <BriefingPanel />

          {/* KPI Row */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-border/20 bg-card/10">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
              <KpiCard label="TOTAL SIGNALS" value={stats?.total || 0} icon={Radio} color="hsl(175,85%,50%)" />
              <KpiCard label="HIGH PRIORITY" value={stats?.breakingCount || 0} icon={AlertTriangle} color="hsl(0,70%,55%)" />
              <KpiCard label="MODEL RELEASES" value={stats?.byCategory?.model_release || 0} icon={Brain} color="hsl(175,85%,50%)" />
              <KpiCard label="SOURCES ACTIVE" value={sourceCount} icon={Activity} color="hsl(140,60%,50%)" />
            </div>
          </div>

          <FeedToolbar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
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
            feedItemCount={feedItems.length}
            stats={stats}
            onSelectCategory={handleSelectCategory}
          />

          <FeedStream
            feedItems={feedItems}
            isLoading={isLoading}
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
          />
        </div>

        <IntelPanel stats={stats} feedItems={feedItems} />
      </div>
    </div>
  );
}
