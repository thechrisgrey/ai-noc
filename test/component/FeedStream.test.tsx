// @vitest-environment jsdom
import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedStream } from "../../client/src/components/dashboard/FeedStream";

function renderStream(overrides: Partial<Parameters<typeof FeedStream>[0]> = {}) {
  const props = {
    feedItems: [],
    isLoading: false,
    isError: false,
    onRetry: () => {},
    showBookmarks: false,
    sortMode: "time" as const,
    groupedItems: [],
    breakingItems: [],
    bookmarksList: [],
    loadMoreRef: createRef<HTMLDivElement>(),
    isFetchingNextPage: false,
    newSignals: 0,
    onDismissNewSignals: () => {},
    onToggleBookmark: () => {},
    ...overrides,
  };
  return render(<FeedStream {...props} />);
}

describe("<FeedStream />", () => {
  it("renders the error state when the feed query fails", () => {
    renderStream({ isError: true });
    expect(screen.getByText("SIGNAL LINK DOWN")).toBeInTheDocument();
    expect(screen.getByText(/Feed unavailable/i)).toBeInTheDocument();
  });

  it("fires onRetry when RETRY is clicked", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderStream({ isError: true, onRetry: spy });
    await user.click(screen.getByRole("button", { name: /RETRY/i }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("renders the loading skeleton while fetching", () => {
    const { container } = renderStream({ isLoading: true });
    expect(container.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThan(0);
    expect(screen.queryByText("SIGNAL LINK DOWN")).toBeNull();
  });
});
