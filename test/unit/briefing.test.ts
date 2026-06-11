import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { generateBriefing } from "../../server/briefing";
import { createTestStorage } from "../helpers/db";
import type { IStorage } from "../../server/storage";
import type { InsertFeedItem } from "@shared/schema";

const bedrockMock = mockClient(BedrockRuntimeClient);

function makeItem(n: number): InsertFeedItem {
  const now = new Date().toISOString();
  return {
    title: `Signal ${n}`,
    description: `Description for signal ${n}`,
    url: null,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: now,
    fetchedAt: now,
    guid: `briefing-test-${n}`,
    isBreaking: false,
    imageUrl: null,
  };
}

function encodeBody(payload: unknown): InvokeModelCommandOutput["body"] {
  return new TextEncoder().encode(
    JSON.stringify(payload),
  ) as InvokeModelCommandOutput["body"];
}

describe("generateBriefing", () => {
  let storage: IStorage;

  beforeEach(async () => {
    bedrockMock.reset();
    ({ storage } = await createTestStorage());
  });

  afterEach(async () => {
    await storage.close();
  });

  it("persists and returns the briefing on a successful Bedrock response", async () => {
    for (let i = 1; i <= 3; i++) await storage.createFeedItem(makeItem(i));
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ content: [{ text: "Executive briefing text." }] }),
    });

    const content = await generateBriefing(storage);

    expect(content).toBe("Executive briefing text.");
    const latest = await storage.getLatestBriefing();
    expect(latest).toBeDefined();
    expect(latest!.content).toBe("Executive briefing text.");
    expect(latest!.itemCount).toBe(3);
  });

  it("returns null and does not invoke Bedrock with fewer than 3 items", async () => {
    await storage.createFeedItem(makeItem(1));
    await storage.createFeedItem(makeItem(2));
    const getFeedItemsSpy = vi.spyOn(storage, "getFeedItems");

    const content = await generateBriefing(storage);

    expect(content).toBeNull();
    expect(bedrockMock.calls()).toHaveLength(0);
    // Sparse 24h window triggers exactly one retry at the 72h window.
    expect(getFeedItemsSpy).toHaveBeenCalledTimes(2);
    expect(getFeedItemsSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sinceHours: 24 }),
    );
    expect(getFeedItemsSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sinceHours: 72 }),
    );
  });

  it("widens the window to 72 hours when the 24-hour window is too sparse", async () => {
    const publishedAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    for (let i = 1; i <= 3; i++) {
      await storage.createFeedItem({ ...makeItem(i), publishedAt });
    }
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ content: [{ text: "Wide window briefing." }] }),
    });

    const content = await generateBriefing(storage);

    expect(content).toBe("Wide window briefing.");
    const latest = await storage.getLatestBriefing();
    expect(latest!.itemCount).toBe(3);
  });

  it("returns null when Bedrock send throws", async () => {
    for (let i = 1; i <= 3; i++) await storage.createFeedItem(makeItem(i));
    bedrockMock.on(InvokeModelCommand).rejects(new Error("throttled"));

    const content = await generateBriefing(storage);

    expect(content).toBeNull();
    expect(await storage.getLatestBriefing()).toBeUndefined();
  });

  it("returns null when the response content array is empty", async () => {
    for (let i = 1; i <= 3; i++) await storage.createFeedItem(makeItem(i));
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ content: [] }),
    });

    const content = await generateBriefing(storage);

    expect(content).toBeNull();
    expect(await storage.getLatestBriefing()).toBeUndefined();
  });
});
