// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../../client/src/components/dashboard/Sidebar";
import type { Stats } from "../../client/src/components/dashboard/constants";

const stats: Stats = {
  total: 10,
  byCategory: { model_release: 4 },
  bySource: { openai: 6, anthropic: 4 },
  breakingCount: 1,
  unreadCount: 3,
};

function renderSidebar(overrides: {
  onDeleteWatchlist?: (id: number) => void;
  onToggleWatchlistAlert?: (id: number, alert: boolean) => void;
  watchlistsData?: any[];
} = {}) {
  return render(
    <Sidebar
      stats={stats}
      selectedCategory="all"
      selectedSource="all"
      showBookmarks={false}
      watchlistsData={overrides.watchlistsData ?? [{ id: 1, name: "GPU launches" }]}
      onSelectCategory={() => {}}
      onSelectSource={() => {}}
      onApplyWatchlist={() => {}}
      onToggleWatchlistAlert={overrides.onToggleWatchlistAlert ?? (() => {})}
      onDeleteWatchlist={overrides.onDeleteWatchlist ?? (() => {})}
    />,
  );
}

describe("<Sidebar />", () => {
  it("gives the watchlist delete button an accessible name", () => {
    renderSidebar();
    expect(
      screen.getByRole("button", { name: "Delete watchlist GPU launches" }),
    ).toBeInTheDocument();
  });

  it("fires onDeleteWatchlist with the watchlist id", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderSidebar({ onDeleteWatchlist: spy });
    await user.click(screen.getByRole("button", { name: "Delete watchlist GPU launches" }));
    expect(spy).toHaveBeenCalledWith(1);
  });

  it("exposes the alert toggle with aria-pressed reflecting alert state", () => {
    renderSidebar({ watchlistsData: [{ id: 1, name: "GPU launches", alert: true }] });
    const toggle = screen.getByRole("button", { name: "Toggle alerts for GPU launches" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("fires onToggleWatchlistAlert flipping the current alert state", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderSidebar({
      onToggleWatchlistAlert: spy,
      watchlistsData: [{ id: 7, name: "GPU launches", alert: false }],
    });
    await user.click(screen.getByRole("button", { name: "Toggle alerts for GPU launches" }));
    expect(spy).toHaveBeenCalledWith(7, true);
  });
});
