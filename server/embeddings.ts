import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0";
const EMBED_DIMENSIONS = 1024;
// Titan caps input tokens; slice well under the limit so long descriptions
// never fail the whole embed call.
const MAX_INPUT_CHARS = 6000;

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

/** Embeddings are on unless EMBEDDINGS_ENABLED is explicitly "false". */
export function isEmbeddingsEnabled(): boolean {
  return process.env.EMBEDDINGS_ENABLED !== "false";
}

/**
 * Embed a single string via Titan v2. Returns a 1024-d cosine-normalized
 * vector, or null on any failure (never throws — callers leave embedding NULL
 * and the backfill sweep retries).
 */
export async function embedText(text: string): Promise<number[] | null> {
  try {
    const command = new InvokeModelCommand({
      modelId: EMBED_MODEL_ID,
      contentType: "application/json",
      body: JSON.stringify({
        inputText: text.slice(0, MAX_INPUT_CHARS),
        dimensions: EMBED_DIMENSIONS,
        normalize: true,
      }),
    });
    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const embedding = responseBody.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBED_DIMENSIONS) {
      console.error("[Embeddings] Unexpected embedding shape from Bedrock");
      return null;
    }
    return embedding as number[];
  } catch (err) {
    console.error("[Embeddings] embedText failed:", (err as Error).message);
    return null;
  }
}

/**
 * Embed many strings with bounded concurrency. Preserves input order; a failed
 * item yields null in its slot.
 */
export async function embedMany(
  texts: string[],
  concurrency = 3,
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= texts.length) return;
      results[i] = await embedText(texts[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, texts.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Cosine similarity of two equal-length vectors (1 == identical direction). */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
