// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  timeAgo,
  getTimeGroup,
  extractTrending,
} from "../../client/src/components/dashboard/utils";
import type { FeedItemWithBookmark } from "../../client/src/components/dashboard/constants";

function buildItem(title: string, id = 1): FeedItemWithBookmark {
  return {
    id,
    title,
    description: null,
    url: null,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    guid: `g-${id}`,
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 0,
    readAt: null,
    embedding: null,
    isBookmarked: false,
  };
}

describe("timeAgo", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-04-19T12:00:00Z")));
  afterEach(() => vi.useRealTimers());

  it("<1m reports JUST NOW", () => {
    expect(timeAgo(new Date("2026-04-19T11:59:30Z").toISOString())).toBe("JUST NOW");
  });

  it("minutes then hours then days", () => {
    expect(timeAgo(new Date("2026-04-19T11:40:00Z").toISOString())).toBe("20m");
    expect(timeAgo(new Date("2026-04-19T09:00:00Z").toISOString())).toBe("3h");
    expect(timeAgo(new Date("2026-04-15T12:00:00Z").toISOString())).toBe("4d");
  });
});

describe("getTimeGroup", () => {
  // getTimeGroup uses local-timezone .toDateString() comparison, so fake "now"
  // and candidate dates must both sit at local noon to stay TZ-agnostic.
  const dayAt = (iso: string) => {
    const d = new Date(iso);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  beforeEach(() => vi.useFakeTimers().setSystemTime(dayAt("2026-04-19T00:00:00")));
  afterEach(() => vi.useRealTimers());

  it("today bucket", () => {
    expect(getTimeGroup(dayAt("2026-04-19T00:00:00").toISOString())).toBe("TODAY");
  });

  it("yesterday bucket", () => {
    expect(getTimeGroup(dayAt("2026-04-18T00:00:00").toISOString())).toBe("YESTERDAY");
  });

  it("this week bucket", () => {
    expect(getTimeGroup(dayAt("2026-04-15T00:00:00").toISOString())).toBe("THIS WEEK");
  });

  it("earlier bucket", () => {
    expect(getTimeGroup(dayAt("2026-03-14T00:00:00").toISOString())).toBe("EARLIER");
  });
});

describe("extractTrending", () => {
  it("returns words ranked by cross-item frequency", () => {
    const items = [
      buildItem("OpenAI releases GPT-5 Turbo", 1),
      buildItem("Anthropic releases Claude 4 Opus", 2),
      buildItem("Google releases Gemini Ultra", 3),
    ];
    const trending = extractTrending(items);
    expect(trending[0].word).toBe("releases");
    expect(trending[0].count).toBe(3);
  });

  it("drops stop words", () => {
    const items = [
      buildItem("The new and improved model", 1),
      buildItem("The best and fastest model", 2),
    ];
    const trending = extractTrending(items);
    expect(trending.map((t) => t.word)).not.toContain("the");
    expect(trending.map((t) => t.word)).not.toContain("and");
    expect(trending.map((t) => t.word)).toContain("model");
  });

  it("requires cross-item frequency >= 2", () => {
    const items = [buildItem("unique headline", 1)];
    expect(extractTrending(items)).toEqual([]);
  });
});
