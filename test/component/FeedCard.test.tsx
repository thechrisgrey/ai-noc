// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    isBookmarked: false,
    ...overrides,
  };
}

describe("<FeedCard />", () => {
  it("renders title, source label, and category", () => {
    render(<FeedCard item={buildItem()} onToggleBookmark={() => {}} />);
    expect(screen.getByText(/OpenAI launches GPT-5/i)).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText(/model release/i)).toBeInTheDocument();
  });

  it("shows HIGH PRIORITY badge for priority >= 80", () => {
    render(<FeedCard item={buildItem({ priority: 92 })} onToggleBookmark={() => {}} />);
    expect(screen.getByText(/HIGH PRIORITY/i)).toBeInTheDocument();
  });

  it("shows NOTABLE badge for priority between 60 and 79", () => {
    render(<FeedCard item={buildItem({ priority: 70 })} onToggleBookmark={() => {}} />);
    expect(screen.getByText(/NOTABLE/i)).toBeInTheDocument();
  });

  it("fires onToggleBookmark with current bookmark state", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<FeedCard item={buildItem({ isBookmarked: false })} onToggleBookmark={spy} />);
    await user.click(screen.getByLabelText(/bookmark/i));
    expect(spy).toHaveBeenCalledWith(1, false);
  });

  it("uses BookmarkCheck label when already bookmarked", () => {
    render(<FeedCard item={buildItem({ isBookmarked: true })} onToggleBookmark={() => {}} />);
    expect(screen.getByLabelText(/remove bookmark/i)).toBeInTheDocument();
  });

  it("renders external link when url is present", () => {
    render(<FeedCard item={buildItem({ url: "https://example.test/a" })} onToggleBookmark={() => {}} />);
    const link = screen.getByLabelText(/open article/i) as HTMLAnchorElement;
    expect(link.href).toBe("https://example.test/a");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("omits external link when url is null", () => {
    render(<FeedCard item={buildItem({ url: null })} onToggleBookmark={() => {}} />);
    expect(screen.queryByLabelText(/open article/i)).toBeNull();
  });
});
