// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedToolbar, MobileCategoryBar } from "../../client/src/components/dashboard/FeedToolbar";

function renderToolbar(overrides: Record<string, unknown> = {}) {
  const props = {
    searchQuery: "",
    setSearchQuery: vi.fn(),
    searchMode: "lexical" as const,
    setSearchMode: vi.fn(),
    sortMode: "time" as const,
    setSortMode: vi.fn(),
    selectedCategory: "all" as const,
    selectedSource: "all",
    setSelectedSource: vi.fn(),
    showBookmarks: false,
    hasActiveFilters: false,
    savingWatchlist: false,
    setSavingWatchlist: vi.fn(),
    watchlistName: "",
    setWatchlistName: vi.fn(),
    onSaveWatchlist: vi.fn(),
    onMarkAllRead: vi.fn(),
    feedItemCount: 0,
    onSelectCategory: vi.fn(),
    ...overrides,
  };
  render(<FeedToolbar {...(props as any)} />);
  return props;
}

describe("<FeedToolbar /> SEMANTIC pill", () => {
  it("is disabled when the search query is empty", () => {
    renderToolbar({ searchQuery: "" });
    const pill = screen.getByRole("button", { name: /SEMANTIC/i });
    expect(pill).toBeDisabled();
    expect(pill).toHaveAttribute("aria-pressed", "false");
  });

  it("is enabled and toggles searchMode when a query is present", async () => {
    const user = userEvent.setup();
    const { setSearchMode } = renderToolbar({ searchQuery: "agents" });
    const pill = screen.getByRole("button", { name: /SEMANTIC/i });
    expect(pill).toBeEnabled();
    await user.click(pill);
    expect(setSearchMode).toHaveBeenCalledWith("semantic");
  });

  it("reflects active semantic mode via aria-pressed", () => {
    renderToolbar({ searchQuery: "agents", searchMode: "semantic" });
    const pill = screen.getByRole("button", { name: /SEMANTIC/i });
    expect(pill).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles back to lexical when already semantic", async () => {
    const user = userEvent.setup();
    const { setSearchMode } = renderToolbar({ searchQuery: "agents", searchMode: "semantic" });
    await user.click(screen.getByRole("button", { name: /SEMANTIC/i }));
    expect(setSearchMode).toHaveBeenCalledWith("lexical");
  });
});

describe("<MobileCategoryBar /> section chips", () => {
  function renderMobileCategoryBar(selectedSection: "all" | "ai" | "csp" | "quantum" = "all", onSelectSection = vi.fn()) {
    render(
      <MobileCategoryBar
        stats={undefined}
        selectedCategory="all"
        showBookmarks={false}
        onSelectCategory={vi.fn()}
        selectedSection={selectedSection}
        onSelectSection={onSelectSection}
      />,
    );
    return { onSelectSection };
  }

  it("renders all four section chips with the active one aria-pressed true", () => {
    renderMobileCategoryBar("csp");
    for (const label of ["ALL", "AI", "CSP", "QUANTUM"]) {
      expect(screen.getByRole("button", { name: `Show ${label} section` })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Show CSP section" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show AI section" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Show ALL section" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Show QUANTUM section" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onSelectSection with the correct value when a chip is clicked", async () => {
    const user = userEvent.setup();
    const { onSelectSection } = renderMobileCategoryBar("all");
    await user.click(screen.getByRole("button", { name: "Show QUANTUM section" }));
    expect(onSelectSection).toHaveBeenCalledWith("quantum");
  });
});
