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

function renderSidebar(onDeleteWatchlist: (id: number) => void = () => {}) {
  return render(
    <Sidebar
      stats={stats}
      selectedCategory="all"
      selectedSource="all"
      showBookmarks={false}
      watchlistsData={[{ id: 1, name: "GPU launches" }]}
      onSelectCategory={() => {}}
      onSelectSource={() => {}}
      onApplyWatchlist={() => {}}
      onDeleteWatchlist={onDeleteWatchlist}
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
    renderSidebar(spy);
    await user.click(screen.getByRole("button", { name: "Delete watchlist GPU launches" }));
    expect(spy).toHaveBeenCalledWith(1);
  });
});
