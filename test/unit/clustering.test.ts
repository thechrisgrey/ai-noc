import { describe, it, expect } from "vitest";
import { similarity } from "../../server/clustering";

describe("similarity (trigram Jaccard)", () => {
  it("identical strings score 1.0", () => {
    expect(similarity("OpenAI releases GPT-5", "OpenAI releases GPT-5")).toBe(1);
  });

  it("completely different strings score near 0", () => {
    expect(similarity("Anthropic funding round", "GPU inference chip")).toBeLessThan(0.1);
  });

  it("paraphrases exceed clustering threshold", () => {
    const a = "OpenAI launches GPT-5 with improved reasoning";
    const b = "OpenAI launches GPT-5 with improved reasoning capabilities";
    expect(similarity(a, b)).toBeGreaterThan(0.35);
  });

  it("case-insensitive and punctuation-insensitive", () => {
    expect(similarity("Claude 4 Released", "claude 4 released!")).toBeGreaterThan(0.8);
  });

  it("returns 0 when either side is empty", () => {
    expect(similarity("", "anything")).toBe(0);
    expect(similarity("anything", "")).toBe(0);
  });

  it("short strings below trigram window produce 0", () => {
    expect(similarity("ab", "ab")).toBe(0);
  });
});
