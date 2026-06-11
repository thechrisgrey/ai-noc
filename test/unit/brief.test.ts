import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandInput,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { generateBrief } from "../../server/brief";
import { clearWatchlistEmbeddingCache } from "../../server/watchlistMatcher";
import { createTestStorage } from "../helpers/db";
import type { IStorage } from "../../server/storage";
import type { InsertFeedItem } from "@shared/schema";

const bedrockMock = mockClient(BedrockRuntimeClient);

// 1024-d helpers so vectors fit the pgvector(1024) column.
function unitVector(n: number): number[] {
  return new Array(1024).fill(0).map((_, i) => (i === n ? 1 : 0));
}
// Unit vector with cosine 0.6 against unitVector(0): in the periphery band.
function bandVector(): number[] {
  const v = new Array(1024).fill(0);
  v[0] = 0.6;
  v[1] = 0.8;
  return v;
}

const TRACK_VEC = unitVector(0);

function encodeBody(payload: unknown): InvokeModelCommandOutput["body"] {
  return new TextEncoder().encode(
    JSON.stringify(payload),
  ) as InvokeModelCommandOutput["body"];
}

// Route the shared Bedrock mock: Titan embed requests carry inputText; the
// Claude implication draft carries messages.
function wireBedrock() {
  bedrockMock.on(InvokeModelCommand).callsFake((input: InvokeModelCommandInput) => {
    const body = JSON.parse(input.body as string);
    if (body.inputText !== undefined) {
      return { body: encodeBody({ embedding: TRACK_VEC }) };
    }
    const lines: string[] = [];
    for (let i = 1; i <= 12; i++) {
      lines.push(`[${i}] drafted ${i} **Why it matters:** because ${i}`);
    }
    return { body: encodeBody({ content: [{ text: lines.join("\n") }] }) };
  });
}

let seq = 0;
function makeItem(overrides: Partial<InsertFeedItem> = {}): InsertFeedItem {
  const now = new Date().toISOString();
  seq += 1;
  return {
    title: `Signal ${seq}`,
    description: `Description for signal ${seq}`,
    url: `https://x.test/${seq}`,
    source: "openai",
    sourceLabel: "OpenAI",
    category: "model_release",
    publishedAt: now,
    fetchedAt: now,
    guid: `brief-test-${seq}-${Math.round(performance.now() * 1000)}`,
    isBreaking: false,
    imageUrl: null,
    priority: 50,
    ...overrides,
  };
}

describe("generateBrief", () => {
  let storage: IStorage;

  beforeEach(async () => {
    bedrockMock.reset();
    clearWatchlistEmbeddingCache();
    wireBedrock();
    ({ storage } = await createTestStorage());
  });

  afterEach(async () => {
    await storage.close();
  });

  it("groups CORE by track, drafts a so-what, and stores a draft awaiting review", async () => {
    await storage.createWatchlist({
      name: "Models",
      category: null,
      source: null,
      search: "gpt",
      sort: null,
      alert: false,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
    });

    await storage.createFeedItem(
      makeItem({ title: "OpenAI ships GPT-6 today", priority: 72 }),
    );
    await storage.createFeedItem(
      makeItem({ title: "A minor tooling update", source: "techcrunch", sourceLabel: "TechCrunch", category: "product", priority: 30 }),
    );

    const brief = await generateBrief("daily_skim", storage);

    expect(brief).not.toBeNull();
    expect(brief!.kind).toBe("daily_skim");
    expect(brief!.status).toBe("draft");
    expect(brief!.content).toContain("## CORE — Models");
    expect(brief!.content).toContain("## SOURCES");
    // Subject is derived from the lead CORE item, not fabricated by the model.
    expect(brief!.subject).toMatch(/^AI brief: /);
    expect(brief!.subject).toContain("OpenAI ships GPT-6");
    // Server-built legend links the tracked item.
    expect(brief!.content).toMatch(/\[1\] OpenAI ships GPT-6 today — https:\/\/x\.test\/\d/);
    // The off-track tooling update is below the periphery floor → not surfaced.
    expect(brief!.content).not.toContain("A minor tooling update");
    expect(brief!.content).toContain("Nothing off your tracks cleared the bar today.");
  });

  it("admits an off-track in-band high-importance item to PERIPHERY, rejecting the rest", async () => {
    await storage.createWatchlist({
      name: "Models",
      category: null,
      source: null,
      search: "models",
      sort: null,
      alert: false,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
    });

    const core = await storage.createFeedItem(
      makeItem({ title: "Three new models shipped", priority: 70 }),
    );
    const peri = await storage.createFeedItem(
      makeItem({ title: "Quantum breakthrough announced", category: "research", priority: 70 }),
    );
    const noise = await storage.createFeedItem(
      makeItem({ title: "Unrelated chip rumor", category: "product", priority: 95 }),
    );
    const low = await storage.createFeedItem(
      makeItem({ title: "Tiny library patch", category: "product", priority: 50 }),
    );

    // peri & low sit in the serendipity band (cosine 0.6 to the track vector);
    // noise is orthogonal (cosine 0). core needs no embedding (lexical hit).
    await storage.updateEmbeddings([
      { id: peri.id, embedding: bandVector() },
      { id: noise.id, embedding: unitVector(1) },
      { id: low.id, embedding: bandVector() },
    ]);

    const brief = await generateBrief("daily_skim", storage);

    expect(brief).not.toBeNull();
    expect(brief!.content).toContain("## PERIPHERY — you didn't ask, but you'd want to know");
    expect(brief!.content).not.toContain("Nothing off your tracks cleared the bar today.");
    // Admitted: off-track, in-band, importance >= floor.
    expect(brief!.content).toContain("Quantum breakthrough announced");
    // Rejected by the band gate (orthogonal), despite the highest priority.
    expect(brief!.content).not.toContain("Unrelated chip rumor");
    // Rejected by the importance gate (in-band but below the floor).
    expect(brief!.content).not.toContain("Tiny library patch");
    // CORE (lexical track hit) is present.
    expect(brief!.content).toContain("## CORE — Models");
    // 1 core + 1 periphery surfaced.
    expect(brief!.itemCount).toBe(2);
  });

  it("returns null when no item matches a track and none clears periphery", async () => {
    await storage.createFeedItem(makeItem({ title: "Off-topic news", category: "policy", priority: 20 }));
    const brief = await generateBrief("daily_skim", storage);
    expect(brief).toBeNull();
  });
});
