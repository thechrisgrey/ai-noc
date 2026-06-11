import { RefreshCw, Bookmark, Bell, BellOff } from "lucide-react";
import type { UseMutationResult } from "@tanstack/react-query";
import { type Stats } from "./constants";
import { StatusBar } from "./StatusBar";
import { BriefWorkshop } from "./BriefWorkshop";
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
    <header className="flex-shrink-0 h-14 flex items-center border-b border-white/[0.06] bg-background/80 backdrop-blur-sm px-5 z-20">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            aria-label="AI Operations Center"
            className="text-primary"
          >
            <rect x="2" y="2" width="28" height="28" rx="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="16" cy="16" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="16" cy="16" r="2" fill="currentColor" />
            <line x1="16" y1="2" x2="16" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <line x1="16" y1="22" x2="16" y2="30" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <line x1="2" y1="16" x2="10" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <line x1="22" y1="16" x2="30" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5" />
          </svg>
          <div>
            <h1 className="text-sm font-semibold tracking-[0.14em] uppercase text-foreground">
              AI OPS CENTER
            </h1>
            <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground hidden sm:block">
              INTELLIGENCE MONITORING & OBSERVABILITY
            </p>
          </div>
        </div>

        <StatusBar lastSynced={stats?.lastRefreshed} />

        <div className="flex items-center gap-2">
          <BriefWorkshop />
          <button
            onClick={() => setShowBookmarks(!showBookmarks)}
            aria-pressed={showBookmarks}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors data-readout ${
              showBookmarks
                ? "bg-primary/15 text-primary border-primary/25"
                : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
            }`}
          >
            <Bookmark size={12} />
            <span className="hidden sm:inline">SAVED</span>
            <span className="data-readout tabular-nums">({bookmarksCount})</span>
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
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors data-readout ${
              notificationsEnabled
                ? "bg-primary/15 text-primary border-primary/25"
                : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
            }`}
            title={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
          >
            {notificationsEnabled ? <Bell size={12} /> : <BellOff size={12} />}
          </button>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground shadow-[0_0_16px_hsla(68,96%,58%,0.25)] transition-all hover:brightness-110 disabled:opacity-60 disabled:hover:brightness-100 data-readout"
          >
            <RefreshCw
              size={12}
              className={refreshMutation.isPending ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">
              {refreshMutation.isPending ? "SYNCING" : "SYNC"}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
