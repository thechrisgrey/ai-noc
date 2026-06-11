import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { storage, type IStorage } from "./storage";

const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

const SYSTEM_PROMPT = `You are an AI industry intelligence analyst for a real-time monitoring system called AI OPS CENTER. Summarize the provided signals into a concise 3-5 sentence executive briefing. Be specific: name what shipped, who announced it, and why it matters. Use a terse, professional tone. No preamble, no sign-off, no bullet points — just flowing prose.`;

export async function generateBriefing(store: IStorage = storage): Promise<string | null> {
  try {
    // Top items by priority from the last 24 hours; widen to 72 hours once
    // before giving up so quiet news days still produce a briefing.
    let result = await store.getFeedItems({
      limit: 10,
      sort: "priority",
      sinceHours: 24,
    });
    if (result.items.length < 3) {
      result = await store.getFeedItems({
        limit: 10,
        sort: "priority",
        sinceHours: 72,
      });
    }

    const items = result.items;
    if (items.length < 3) {
      console.log("[Briefing] Not enough items to generate briefing");
      return null;
    }

    // Build the prompt from feed items
    const signalList = items
      .map(
        (i, idx) =>
          `${idx + 1}. [${i.sourceLabel}] (${i.category.replace("_", " ")}, P${i.priority ?? 0}) ${i.title}${i.description ? ": " + i.description.slice(0, 200) : ""}`,
      )
      .join("\n");

    const userPrompt = `Here are the top ${items.length} AI industry signals right now:\n\n${signalList}\n\nGenerate the executive briefing.`;

    // Call Bedrock
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 300,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const briefingText = responseBody.content?.[0]?.text;

    if (!briefingText) {
      console.error("[Briefing] Empty response from Bedrock");
      return null;
    }

    // Cache in database
    const briefing = await store.createBriefing({
      content: briefingText,
      itemCount: items.length,
      generatedAt: new Date().toISOString(),
    });

    console.log(
      `[Briefing] Generated from ${items.length} items (${briefingText.length} chars)`,
    );
    return briefing.content;
  } catch (err) {
    console.error(
      "[Briefing] Generation failed:",
      (err as Error).message,
    );
    return null;
  }
}
