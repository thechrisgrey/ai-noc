import { describe, it, expect } from "vitest";
import { __testing__normalizeEntry as normalizeEntry } from "../../server/feedEngine";

const source = { source: "openai", sourceLabel: "OpenAI", defaultCategory: "product" };
const nowISO = "2026-06-10T12:00:00.000Z";

describe("normalizeEntry", () => {
  it("falls back to nowISO when pubDate is malformed instead of throwing", () => {
    const item = normalizeEntry(
      { title: "Malformed date entry", pubDate: "not a real date" },
      source,
      nowISO,
    );
    expect(item).not.toBeNull();
    expect(item!.publishedAt).toBe(nowISO);
  });

  it("builds a source-title-date composite guid when guid and link are missing", () => {
    const item = normalizeEntry({ title: "Some Title" }, source, nowISO);
    expect(item!.guid).toBe(`openai-Some Title-${nowISO}`);
  });

  it("defaults a missing title to Untitled", () => {
    const item = normalizeEntry({}, source, nowISO);
    expect(item!.title).toBe("Untitled");
  });

  it("truncates the description to 500 characters", () => {
    const item = normalizeEntry(
      { title: "Long entry", contentSnippet: "x".repeat(1000) },
      source,
      nowISO,
    );
    expect(item!.description).toHaveLength(500);
  });
});
