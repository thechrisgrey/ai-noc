import { describe, it, expect } from "vitest";
import {
  __testing__categorizeItem as categorizeItem,
  __testing__isBreakingNews as isBreakingNews,
} from "../../server/feedEngine";

describe("categorizeItem", () => {
  it("prefers model_release when keywords match", () => {
    expect(
      categorizeItem("OpenAI announces new model GPT-5", "100B parameter weights released", "product"),
    ).toBe("model_release");
  });

  it("prefers research when arxiv/paper keywords dominate", () => {
    expect(
      categorizeItem("Novel method for alignment", "new training algorithm paper arxiv", "product"),
    ).toBe("research");
  });

  it("prefers funding when investment keywords match", () => {
    expect(categorizeItem("Anthropic raises $5B at $60B valuation", null, "product")).toBe("funding");
  });

  it("falls back to default category when no keywords match", () => {
    expect(categorizeItem("Just a headline", "nothing of substance", "policy")).toBe("policy");
  });

  it("prefers infrastructure for GPU/chip headlines", () => {
    expect(
      categorizeItem("NVIDIA H200 GPU inference memory", "hardware accelerator", "product"),
    ).toBe("infrastructure");
  });
});

describe("isBreakingNews", () => {
  const now = () => new Date().toISOString();
  const old = () => new Date(Date.now() - 72 * 3600 * 1000).toISOString();

  it("tier-1 single-match keyword triggers breaking", () => {
    expect(isBreakingNews("Breaking: GPT-5 available now", null, now())).toBe(true);
  });

  it("tier-2 requires two matches", () => {
    expect(isBreakingNews("Announcing new model breakthrough", null, now())).toBe(true);
    expect(isBreakingNews("Another announcing post", null, now())).toBe(false);
  });

  it("items older than 48h are never breaking", () => {
    expect(isBreakingNews("Breaking: GPT-5 available now", null, old())).toBe(false);
  });

  it("empty or unrelated content is not breaking", () => {
    expect(isBreakingNews("A quiet Tuesday product update", null, now())).toBe(false);
  });
});
