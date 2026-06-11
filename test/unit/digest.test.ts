import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { generateDailyDigest } from "../../server/digest";
import { createTestStorage } from "../helpers/db";
import type { IStorage } from "../../server/storage";
import type { InsertFeedItem } from "@shared/schema";

const bedrockMock = mockClient(BedrockRuntimeClient);

function makeItem(n: number, overrides: Partial<InsertFeedItem> = {}): InsertFeedItem {
  const now = new Date().toISOString();
  return {
    title: `Signal ${n}`,
    description: `Description for signal ${n}`,
    url: `https://x.test/${n}`,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: now,
    fetchedAt: now,
    guid: `digest-test-${n}`,
    isBreaking: false,
    imageUrl: null,
    ...overrides,
  };
}

function encodeBody(payload: unknown): InvokeModelCommandOutput["body"] {
  return new TextEncoder().encode(
    JSON.stringify(payload),
  ) as InvokeModelCommandOutput["body"];
}

function lastPrompt(): string {
  const call = bedrockMock.commandCalls(InvokeModelCommand)[0];
  const body = JSON.parse((call.args[0].input as { body: string }).body);
  return body.messages[0].content as string;
}

describe("generateDailyDigest", () => {
  let storage: IStorage;

  beforeEach(async () => {
    bedrockMock.reset();
    ({ storage } = await createTestStorage());
  });

  afterEach(async () => {
    await storage.close();
  });

  it("returns null and skips Bedrock with fewer than 3 story groups", async () => {
    for (let i = 1; i <= 2; i++) await storage.createFeedItem(makeItem(i));
    const content = await generateDailyDigest(storage);
    expect(content).toBeNull();
    expect(bedrockMock.calls()).toHaveLength(0);
    expect(await storage.getLatestBriefing("daily_digest")).toBeUndefined();
  });

  it("collapses clustered items into a single story group", async () => {
    // Two items share a cluster (one story group); two more are standalone.
    const a = await storage.createFeedItem(makeItem(1));
    const b = await storage.createFeedItem(
      makeItem(2, { sourceLabel: "Anthropic", source: "anthropic" }),
    );
    await storage.createFeedItem(makeItem(3, { category: "research" }));
    await storage.createFeedItem(makeItem(4, { category: "funding" }));
    await storage.bulkUpdateClusterIds([
      { id: a.id, clusterId: "story-1" },
      { id: b.id, clusterId: "story-1" },
    ]);

    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ content: [{ text: "## MODEL RELEASE\nStory [1] shipped." }] }),
    });

    const content = await generateDailyDigest(storage);
    expect(content).not.toBeNull();

    // 4 items -> 3 groups (clustered pair + two singletons).
    const latest = await storage.getLatestBriefing("daily_digest");
    expect(latest!.itemCount).toBe(3);

    // The clustered pair collapses into one numbered entry that lists both
    // source labels together (order within the group is priority-then-insertion).
    const prompt = lastPrompt();
    const clusteredLine = prompt
      .split("\n")
      .find((l) => l.includes("Signal 1") && l.includes("Signal 2"));
    expect(clusteredLine).toBeDefined();
    expect(clusteredLine).toContain("OpenAI");
    expect(clusteredLine).toContain("Anthropic");
  });

  it("appends a server-built legend and stamps kind 'daily_digest'", async () => {
    for (let i = 1; i <= 3; i++) {
      await storage.createFeedItem(makeItem(i, { category: i === 1 ? "model_release" : i === 2 ? "research" : "funding" }));
    }
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ content: [{ text: "## MODEL RELEASE\nA tight paragraph citing [1]." }] }),
    });

    const content = await generateDailyDigest(storage);
    expect(content).toContain("## MODEL RELEASE");
    // Legend lines are server-built from the representative item url.
    expect(content).toMatch(/\[1\] Signal \d+ — https:\/\/x\.test\/\d/);

    const latest = await storage.getLatestBriefing("daily_digest");
    expect(latest!.kind).toBe("daily_digest");
    // The digest must not surface as the hourly briefing.
    expect(await storage.getLatestBriefing("hourly")).toBeUndefined();
  });

  it("returns null when Bedrock send throws", async () => {
    for (let i = 1; i <= 3; i++) {
      await storage.createFeedItem(makeItem(i, { category: i === 1 ? "model_release" : i === 2 ? "research" : "funding" }));
    }
    bedrockMock.on(InvokeModelCommand).rejects(new Error("throttled"));
    expect(await generateDailyDigest(storage)).toBeNull();
    expect(await storage.getLatestBriefing("daily_digest")).toBeUndefined();
  });
});
