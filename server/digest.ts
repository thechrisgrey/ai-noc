import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { storage, type IStorage } from "./storage";
import type { FeedItem } from "@shared/schema";

const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

// How many story groups the digest covers. Past this the prompt gets unwieldy
// and the email overlong.
const MAX_GROUPS = 12;

const SYSTEM_PROMPT = `You are an AI industry intelligence analyst writing the AI NOC daily digest. Write a plain-text digest of the day's signals. Organize the digest into sections, one per category present in the data, each headed by a line of the form '## CATEGORY NAME'. Under each section, write one tight paragraph per numbered story, citing the story with its bracket number like [3]. Do not invent stories outside the numbered list, do not add a preamble or sign-off, and keep the whole digest under 600 words.`;

/** A story group: a representative item plus all items sharing its cluster. */
interface StoryGroup {
  key: string;
  representative: FeedItem;
  items: FeedItem[];
  category: string;
  maxPriority: number;
}

/**
 * Bucket items into story groups: clustered items share a group keyed by their
 * cluster id; unclustered items each form their own group. Ranks groups by max
 * priority, then takes the top MAX_GROUPS while guaranteeing every category
 * present in the data contributes at least one group.
 */
function buildGroups(items: FeedItem[]): StoryGroup[] {
  const byKey = new Map<string, FeedItem[]>();
  for (const item of items) {
    const key = item.clusterId ? `cluster:${item.clusterId}` : `item:${item.id}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  }

  const groups: StoryGroup[] = [];
  for (const [key, groupItems] of Array.from(byKey.entries())) {
    const sorted = [...groupItems].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
    const representative = sorted[0];
    groups.push({
      key,
      representative,
      items: sorted,
      category: representative.category,
      maxPriority: representative.priority ?? 0,
    });
  }

  groups.sort((a, b) => b.maxPriority - a.maxPriority);

  // Take the top groups, but first reserve one slot for each category so the
  // digest never drops an entire category just because its stories ranked low.
  const selected: StoryGroup[] = [];
  const selectedKeys = new Set<string>();
  const seenCategories = new Set<string>();
  for (const group of groups) {
    if (!seenCategories.has(group.category)) {
      seenCategories.add(group.category);
      selected.push(group);
      selectedKeys.add(group.key);
    }
  }
  for (const group of groups) {
    if (selected.length >= MAX_GROUPS) break;
    if (!selectedKeys.has(group.key)) {
      selected.push(group);
      selectedKeys.add(group.key);
    }
  }

  // Trim back to MAX_GROUPS in priority order (category reservations may have
  // pushed us over), keeping the highest-priority groups.
  selected.sort((a, b) => b.maxPriority - a.maxPriority);
  return selected.slice(0, MAX_GROUPS);
}

/**
 * Generate the daily digest: group the last 24h of signals, ask Bedrock for a
 * sectioned plain-text roundup, append a server-built source legend, and store
 * it as a 'daily_digest' briefing. Returns the stored content, or null when
 * there are too few story groups or Bedrock fails.
 */
export async function generateDailyDigest(
  store: IStorage = storage,
): Promise<string | null> {
  try {
    const result = await store.getFeedItems({
      sinceHours: 24,
      sort: "priority",
      limit: 100,
    });
    const groups = buildGroups(result.items);

    if (groups.length < 3) {
      console.log("[Digest] Not enough story groups to generate digest");
      return null;
    }

    const groupList = groups
      .map((g, idx) => {
        const sources = g.items.map((i) => i.sourceLabel).join(", ");
        const titles = g.items.map((i) => i.title).join(" | ");
        const desc = g.representative.description
          ? `: ${g.representative.description.slice(0, 200)}`
          : "";
        return `${idx + 1}. [${g.category.replace("_", " ")}] (${sources}) ${titles}${desc}`;
      })
      .join("\n");

    const userPrompt = `Here are today's top ${groups.length} AI industry story groups:\n\n${groupList}\n\nWrite the daily digest.`;

    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1200,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const digestText = responseBody.content?.[0]?.text;

    if (!digestText) {
      console.error("[Digest] Empty response from Bedrock");
      return null;
    }

    // Server-built legend: one line per group representative so links are never
    // model-fabricated.
    const legend = groups
      .map(
        (g, idx) =>
          `[${idx + 1}] ${g.representative.title} — ${g.representative.url ?? "no link"}`,
      )
      .join("\n");
    const content = `${digestText.trim()}\n\n${legend}`;

    const briefing = await store.createBriefing({
      content,
      itemCount: groups.length,
      generatedAt: new Date().toISOString(),
      kind: "daily_digest",
    });

    console.log(`[Digest] Generated from ${groups.length} story groups (${content.length} chars)`);
    return briefing.content;
  } catch (err) {
    console.error("[Digest] Generation failed:", (err as Error).message);
    return null;
  }
}
