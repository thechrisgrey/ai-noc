// @vitest-environment jsdom
import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedCard } from "../../client/src/components/dashboard/FeedCard";
import type { FeedItemWithBookmark } from "../../client/src/components/dashboard/constants";

function buildItem(overrides: Partial<FeedItemWithBookmark> = {}): FeedItemWithBookmark {
  return {
    id: 1,
    title: "OpenAI launches GPT-5 with improved reasoning",
    description: "Short description text.",
    url: "https://example.test/article",
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    guid: "g1",
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 50,
    readAt: null,
    embedding: null,
    isBookmarked: false,
    ...overrides,
  };
}

// FeedCard lazily fetches cluster siblings via react-query, so renders need a
// provider; the default queryFn resolves to an empty sibling list.
function renderCard(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async () => [] } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("<FeedCard />", () => {
  it("renders title, source label, and category", () => {
    renderCard(<FeedCard item={buildItem()} onToggleBookmark={() => {}} />);
    expect(screen.getByText(/OpenAI launches GPT-5/i)).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText(/model release/i)).toBeInTheDocument();
  });

  it("shows HIGH PRIORITY badge for priority >= 80", () => {
    renderCard(<FeedCard item={buildItem({ priority: 92 })} onToggleBookmark={() => {}} />);
    expect(screen.getByText(/HIGH PRIORITY/i)).toBeInTheDocument();
  });

  it("shows NOTABLE badge for priority between 60 and 79", () => {
    renderCard(<FeedCard item={buildItem({ priority: 70 })} onToggleBookmark={() => {}} />);
    expect(screen.getByText(/NOTABLE/i)).toBeInTheDocument();
  });

  it("fires onToggleBookmark with current bookmark state", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderCard(<FeedCard item={buildItem({ isBookmarked: false })} onToggleBookmark={spy} />);
    await user.click(screen.getByLabelText(/bookmark/i));
    expect(spy).toHaveBeenCalledWith(1, false);
  });

  it("uses BookmarkCheck label when already bookmarked", () => {
    renderCard(<FeedCard item={buildItem({ isBookmarked: true })} onToggleBookmark={() => {}} />);
    expect(screen.getByLabelText(/remove bookmark/i)).toBeInTheDocument();
  });

  it("renders external link when url is present", () => {
    renderCard(<FeedCard item={buildItem({ url: "https://example.test/a" })} onToggleBookmark={() => {}} />);
    const link = screen.getByLabelText(/open article/i) as HTMLAnchorElement;
    expect(link.href).toBe("https://example.test/a");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("omits external link when url is null", () => {
    renderCard(<FeedCard item={buildItem({ url: null })} onToggleBookmark={() => {}} />);
    expect(screen.queryByLabelText(/open article/i)).toBeNull();
  });

  it("shows the unread indicator when readAt is null", () => {
    const { container } = renderCard(
      <FeedCard item={buildItem({ readAt: null })} onToggleBookmark={() => {}} />,
    );
    expect(container.querySelector("[data-unread-indicator]")).not.toBeNull();
  });

  it("hides the unread indicator once the item is read", () => {
    const { container } = renderCard(
      <FeedCard
        item={buildItem({ readAt: new Date().toISOString() })}
        onToggleBookmark={() => {}}
      />,
    );
    expect(container.querySelector("[data-unread-indicator]")).toBeNull();
  });

  it("marks unread items read on card body click", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderCard(
      <FeedCard item={buildItem({ readAt: null })} onToggleBookmark={() => {}} onMarkRead={spy} />,
    );
    await user.click(screen.getByText(/OpenAI launches GPT-5/i));
    expect(spy).toHaveBeenCalledWith(1);
  });

  it("omits the +N SOURCES pill when coverageCount is 1", () => {
    renderCard(
      <FeedCard item={buildItem({ coverageCount: 1 })} onToggleBookmark={() => {}} />,
    );
    expect(screen.queryByText(/SOURCES/)).toBeNull();
  });

  it("toggles the cluster pill aria-expanded on click", async () => {
    const user = userEvent.setup();
    renderCard(
      <FeedCard
        item={buildItem({ clusterId: "story-1", coverageCount: 3 })}
        onToggleBookmark={() => {}}
      />,
    );
    const pill = screen.getByRole("button", { name: /\+2 SOURCES/i });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    await user.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    await user.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a RELATED toggle and expands it on click", async () => {
    const user = userEvent.setup();
    renderCard(<FeedCard item={buildItem()} onToggleBookmark={() => {}} />);
    const pill = screen.getByRole("button", { name: /related signals/i });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    await user.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    // The default queryFn resolves to [], so the empty-state copy shows.
    expect(await screen.findByText(/No related signals found/i)).toBeInTheDocument();
  });
});
