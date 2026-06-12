import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage } from "../../server/storage";

// fetchAllFeeds reads `storage` from server/storage at cycle start; route the
// module-level singleton to a PGlite-backed instance set per describe block.
const holder = vi.hoisted(() => ({ storage: undefined as unknown }));

vi.mock("../../server/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/storage")>();
  return {
    ...actual,
    storage: new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        const inst = holder.storage as Record<string, any>;
        const value = inst[prop as string];
        return typeof value === "function" ? value.bind(inst) : value;
      },
    }),
  };
});

const { parseURLMock } = vi.hoisted(() => ({ parseURLMock: vi.fn() }));

vi.mock("rss-parser", () => ({
  default: class MockRssParser {
    parseURL = parseURLMock;
  },
}));

describe("sources table (PGlite)", () => {
  let storage: DatabaseStorage;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;
  });

  afterAll(async () => {
    await storage.close();
  });

  it("is seeded by the migrations with unique slugs and urls", async () => {
    const all = await storage.getSources();
    expect(all.length).toBe(40);
    expect(all.every((s) => s.enabled)).toBe(true);
    expect(
      all.every((s) => /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(s.createdAt)),
    ).toBe(true);

    const slugs = all.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("openai");
    expect(slugs).toContain("anthropic_gh");
    expect(slugs).toContain("aws_ml");
    expect(slugs).toContain("thinking_machines");
    expect(slugs).toContain("ionq");
    expect(new Set(all.map((s) => s.url)).size).toBe(all.length);
  });

  it("create / update / delete round-trip", async () => {
    const created = await storage.createSource({
      slug: "test_feed",
      label: "Test Feed",
      url: "https://feeds.example.com/test.xml",
      defaultCategory: "research",
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.enabled).toBe(true);

    const updated = await storage.updateSource(created.id, {
      label: "Renamed Feed",
      defaultCategory: "product",
      enabled: false,
    });
    expect(updated?.label).toBe("Renamed Feed");
    expect(updated?.defaultCategory).toBe("product");
    expect(updated?.enabled).toBe(false);
    // Untouched fields survive a partial patch.
    expect(updated?.slug).toBe("test_feed");
    expect(updated?.url).toBe("https://feeds.example.com/test.xml");

    await storage.deleteSource(created.id);
    const all = await storage.getSources();
    expect(all.some((s) => s.id === created.id)).toBe(false);
  });

  it("updateSource returns undefined for a missing id", async () => {
    expect(await storage.updateSource(999999, { enabled: false })).toBeUndefined();
  });

  it("getSources(true) filters to enabled sources only", async () => {
    const all = await storage.getSources();
    const target = all.find((s) => s.slug === "openai")!;

    await storage.updateSource(target.id, { enabled: false });
    const enabled = await storage.getSources(true);
    expect(enabled.length).toBe(all.length - 1);
    expect(enabled.some((s) => s.slug === "openai")).toBe(false);

    await storage.updateSource(target.id, { enabled: true });
    expect((await storage.getSources(true)).length).toBe(all.length);
  });

  it("rejects duplicate slugs and urls at the database level", async () => {
    await expect(
      storage.createSource({
        slug: "openai",
        label: "Duplicate slug",
        url: "https://feeds.example.com/dupe-slug.xml",
        defaultCategory: "product",
        enabled: true,
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();

    await expect(
      storage.createSource({
        slug: "dupe_url",
        label: "Duplicate url",
        url: "https://openai.com/news/rss.xml",
        defaultCategory: "product",
        enabled: true,
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });
});

describe("fetchAllFeeds reads sources from storage", () => {
  let storage: DatabaseStorage;

  beforeAll(async () => {
    const { storage: s, client } = await createTestStorage();
    storage = s;
    holder.storage = s;

    await client.query(`DELETE FROM "sources"`);
    await storage.createSource({
      slug: "stub_on",
      label: "Stub On",
      url: "https://stub.example.com/on.xml",
      defaultCategory: "product",
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    await storage.createSource({
      slug: "stub_off",
      label: "Stub Off",
      url: "https://stub.example.com/off.xml",
      defaultCategory: "product",
      enabled: false,
      createdAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await storage.close();
  });

  it("fetches only enabled sources and stores items under the source slug", async () => {
    parseURLMock.mockReset();
    parseURLMock.mockResolvedValue({
      title: "Stub Feed",
      items: [
        {
          title: "Stub entry",
          link: "https://stub.example.com/entry/1",
          isoDate: new Date().toISOString(),
          guid: "stub-guid-1",
        },
      ],
    });

    const { fetchAllFeeds } = await import("../../server/feedEngine");
    const result = await fetchAllFeeds();

    expect(parseURLMock).toHaveBeenCalledTimes(1);
    expect(parseURLMock).toHaveBeenCalledWith("https://stub.example.com/on.xml");
    expect(result.newItemCount).toBe(1);

    const { items } = await storage.getFeedItems({});
    expect(items.length).toBe(1);
    expect(items[0].source).toBe("stub_on");
    expect(items[0].sourceLabel).toBe("Stub On");
    expect(items[0].category).toBe("product");
  });

  it("re-running the cycle skips already-ingested guids", async () => {
    const { fetchAllFeeds } = await import("../../server/feedEngine");
    const again = await fetchAllFeeds();
    expect(again.newItemCount).toBe(0);
    expect((await storage.getFeedItems({})).items.length).toBe(1);
  });

  it("probeFeedUrl requires a title and at least one item", async () => {
    const { probeFeedUrl } = await import("../../server/feedEngine");

    parseURLMock.mockResolvedValueOnce({ title: "Live Feed", items: [{ title: "x" }] });
    await expect(probeFeedUrl("https://stub.example.com/ok.xml")).resolves.toEqual({
      feedTitle: "Live Feed",
      itemCount: 1,
    });

    parseURLMock.mockResolvedValueOnce({ title: "", items: [{ title: "x" }] });
    await expect(probeFeedUrl("https://stub.example.com/untitled.xml")).rejects.toThrow(
      /no title/,
    );

    parseURLMock.mockResolvedValueOnce({ title: "Empty Feed", items: [] });
    await expect(probeFeedUrl("https://stub.example.com/empty.xml")).rejects.toThrow(
      /no entries/,
    );

    parseURLMock.mockRejectedValueOnce(new Error("Status code 404"));
    await expect(probeFeedUrl("https://stub.example.com/404.xml")).rejects.toThrow(
      "Status code 404",
    );
  });
});
