import { RefreshCw, Bookmark, Bell, BellOff } from "lucide-react";
import type { UseMutationResult } from "@tanstack/react-query";
import { type Stats } from "./constants";
import { StatusBar } from "./StatusBar";
import * as notifications from "@/lib/notifications";

interface HeaderProps {
  stats?: Stats;
  showBookmarks: boolean;
  setShowBookmarks: (v: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  refreshMutation: UseMutationResult<any, Error, void, unknown>;
  bookmarksCount: number;
}

export function Header({
  stats,
  showBookmarks,
  setShowBookmarks,
  notificationsEnabled,
  setNotificationsEnabled,
  refreshMutation,
  bookmarksCount,
}: HeaderProps) {
  return (
    <header className="flex-shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm px-4 py-2 z-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            aria-label="AI Operations Center"
          >
            <rect x="2" y="2" width="28" height="28" rx="4" stroke="hsl(175,85%,40%)" strokeWidth="1.5" fill="none" />
            <circle cx="16" cy="16" r="6" stroke="hsl(175,85%,40%)" strokeWidth="1.5" fill="none" />
            <circle cx="16" cy="16" r="2" fill="hsl(175,85%,40%)" />
            <line x1="16" y1="2" x2="16" y2="10" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
            <line x1="16" y1="22" x2="16" y2="30" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
            <line x1="2" y1="16" x2="10" y2="16" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
            <line x1="22" y1="16" x2="30" y2="16" stroke="hsl(175,85%,40%)" strokeWidth="1" opacity="0.5" />
          </svg>
          <div>
            <h1 className="text-sm font-bold tracking-wider uppercase text-primary glow-text-cyan">
              AI OPS CENTER
            </h1>
            <p className="text-[10px] text-muted-foreground tracking-wider hidden sm:block">
              INTELLIGENCE MONITORING & OBSERVABILITY
            </p>
          </div>
        </div>

        <StatusBar lastSynced={stats?.lastRefreshed} />

        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors data-readout"
          >
            <RefreshCw
              size={12}
              className={refreshMutation.isPending ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">
              {refreshMutation.isPending ? "SYNCING" : "SYNC"}
            </span>
          </button>
          <button
            onClick={() => setShowBookmarks(!showBookmarks)}
            aria-pressed={showBookmarks}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors data-readout ${
              showBookmarks
                ? "border-amber-400/30 text-amber-400 bg-amber-400/10"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bookmark size={12} />
            <span className="hidden sm:inline">SAVED</span>
            <span className="data-readout">({bookmarksCount})</span>
          </button>
          <button
            onClick={async () => {
              if (!notificationsEnabled) {
                const granted = await notifications.requestPermission();
                setNotificationsEnabled(granted);
              } else {
                notifications.setEnabled(false);
                setNotificationsEnabled(false);
              }
            }}
            aria-pressed={notificationsEnabled}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors data-readout ${
              notificationsEnabled
                ? "border-primary/30 text-primary bg-primary/10"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
            title={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
          >
            {notificationsEnabled ? <Bell size={12} /> : <BellOff size={12} />}
          </button>
        </div>
      </div>
    </header>
  );
}
