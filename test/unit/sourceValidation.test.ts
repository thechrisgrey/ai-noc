import { describe, it, expect } from "vitest";
import {
  validateSourceInput,
  slugifyLabel,
  SOURCE_CATEGORIES,
} from "../../server/sourceValidation";

const valid = {
  url: "https://example.com/feed.xml",
  label: "Example Feed",
  defaultCategory: "research",
};

describe("validateSourceInput", () => {
  it("accepts a valid https feed source", () => {
    const result = validateSourceInput(valid, []);
    expect(result).toEqual({
      ok: true,
      url: "https://example.com/feed.xml",
      label: "Example Feed",
      defaultCategory: "research",
      slug: "example_feed",
    });
  });

  it("rejects http URLs", () => {
    const result = validateSourceInput({ ...valid, url: "http://example.com/feed.xml" }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/https/);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateSourceInput({ ...valid, url: "ftp://example.com/feed" }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, url: "file:///etc/passwd" }, []).ok).toBe(false);
  });

  it("rejects unparseable URLs and missing url", () => {
    expect(validateSourceInput({ ...valid, url: "not a url" }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, url: undefined }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, url: 42 }, []).ok).toBe(false);
  });

  it("rejects IPv4 literals", () => {
    const result = validateSourceInput({ ...valid, url: "https://192.168.1.1/feed.xml" }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/IP address/);
  });

  it("rejects bracketed IPv6 literals", () => {
    expect(validateSourceInput({ ...valid, url: "https://[::1]/feed.xml" }, []).ok).toBe(false);
    expect(
      validateSourceInput({ ...valid, url: "https://[2001:db8::1]/feed.xml" }, []).ok,
    ).toBe(false);
  });

  it("rejects localhost and internal-suffix hosts", () => {
    for (const url of [
      "https://localhost/feed.xml",
      "https://printer.local/feed.xml",
      "https://api.internal/feed.xml",
      "https://nas.lan/feed.xml",
    ]) {
      expect(validateSourceInput({ ...valid, url }, []).ok).toBe(false);
    }
  });

  it("rejects dotless hostnames", () => {
    const result = validateSourceInput({ ...valid, url: "https://intranet/feed.xml" }, []);
    expect(result.ok).toBe(false);
  });

  it("rejects categories outside the enum (including 'all')", () => {
    expect(validateSourceInput({ ...valid, defaultCategory: "bogus" }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, defaultCategory: "all" }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, defaultCategory: undefined }, []).ok).toBe(false);
    expect(SOURCE_CATEGORIES).not.toContain("all");
  });

  it("rejects missing, empty, or oversized labels", () => {
    expect(validateSourceInput({ ...valid, label: "" }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, label: "   " }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, label: undefined }, []).ok).toBe(false);
    expect(validateSourceInput({ ...valid, label: "x".repeat(81) }, []).ok).toBe(false);
  });

  it("dedupes slugs against existing ones with a numeric suffix", () => {
    const first = validateSourceInput(valid, ["example_feed"]);
    expect(first.ok && first.slug).toBe("example_feed_2");

    const second = validateSourceInput(valid, ["example_feed", "example_feed_2"]);
    expect(second.ok && second.slug).toBe("example_feed_3");
  });
});

describe("slugifyLabel", () => {
  it("lowercases and collapses non-alphanumerics to underscores", () => {
    expect(slugifyLabel("The Verge -- AI!", [])).toBe("the_verge_ai");
  });

  it("falls back to 'source' when nothing survives", () => {
    expect(slugifyLabel("!!!", [])).toBe("source");
  });
});
