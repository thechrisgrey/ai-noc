import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { storage, type IStorage } from "./storage";
import type { FeedItem, Watchlist } from "@shared/schema";
import { cosineSim, toVector } from "./embeddings";
import {
  getWatchlistEmbeddings,
  matchesWatchlist,
  WATCHLIST_SIM_THRESHOLD,
} from "./watchlistMatcher";
import {
  PERIPHERY_IMPORTANCE_FLOOR,
  PERIPHERY_RELEVANCE_FLOOR,
  PERIPHERY_CAP,
  PERIPHERY_DEDUPE_DAYS,
} from "@shared/constants";

// The two-tier intelligence brief. Unlike the legacy category digest, this is
// organized around the reader's tracked topics (CORE) plus a hard-capped
// serendipity tier of high-importance, off-track items (PERIPHERY). The server
// owns all structure and source links; Bedrock only drafts the per-item
// implication ("so-what"), which the owner reviews and edits before send.

const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

export type BriefKind = "daily_skim" | "weekly_heavy";

interface BriefShape {
  windowHours: number;
  candidateLimit: number;
  maxCore: number;
  label: string;
}

const SHAPES: Record<BriefKind, BriefShape> = {
  // The daily skim is deliberately tight: did anything on my tracks move today.
  daily_skim: { windowHours: 24, candidateLimit: 120, maxCore: 8, label: "Daily skim" },
  // The weekly heavy is the reflective, forwardable artifact.
  weekly_heavy: { windowHours: 168, candidateLimit: 400, maxCore: 16, label: "Weekly brief" },
};

// Description excerpt fed to the model per item. Generous vs the legacy digest's
// 200 chars so the implication has real grounding to work from.
const SOURCE_EXCERPT_CHARS = 800;

/** A story group: a representative item plus all items sharing its cluster. */
interface StoryGroup {
  clusterKey: string;
  representative: FeedItem;
  items: FeedItem[];
  maxPriority: number;
}

/** A CORE group tagged with the track it was assigned to, plus its legend number. */
interface CoreEntry {
  n: number;
  group: StoryGroup;
  trackName: string;
}

interface PeripheryEntry {
  n: number;
  group: StoryGroup;
  similarity: number;
}

/**
 * Bucket items into story groups: clustered items share a group keyed by their
 * cluster id; unclustered items each form their own group. Representative is the
 * highest-priority item in the group.
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
  for (const [clusterKey, groupItems] of Array.from(byKey.entries())) {
    const sorted = [...groupItems].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
    groups.push({
      clusterKey,
      representative: sorted[0],
      items: sorted,
      maxPriority: sorted[0].priority ?? 0,
    });
  }
  return groups;
}

/** Stable cluster identity for surfaced-id dedupe. Falls back to item id. */
function groupClusterId(g: StoryGroup): string {
  return g.representative.clusterId ?? `item:${g.representative.id}`;
}

/**
 * The first watchlist (by stable id order) that any item in the group matches.
 * Tracks are the owner's watchlists; Stage B promotes them to curated tracks.
 * Returns null when the group is off-track (a periphery candidate).
 */
function primaryTrack(
  group: StoryGroup,
  watchlists: Watchlist[],
  embeddingsById: Map<number, number[]>,
): Watchlist | null {
  for (const wl of watchlists) {
    const wlEmbedding = embeddingsById.get(wl.id);
    if (group.items.some((it) => matchesWatchlist(it, wl, wlEmbedding))) {
      return wl;
    }
  }
  return null;
}

/** Max cosine of a group's representative against any track interest vector. */
function trackSimilarity(group: StoryGroup, trackVectors: number[][]): number {
  const vec = toVector(group.representative.embedding);
  if (!vec || trackVectors.length === 0) return 0;
  let best = 0;
  for (const tv of trackVectors) {
    const sim = cosineSim(vec, tv);
    if (sim > best) best = sim;
  }
  return best;
}

/** Cluster ids surfaced in any brief within the dedupe window. */
async function recentlySurfaced(store: IStorage): Promise<Set<string>> {
  const cutoff = new Date(
    Date.now() - PERIPHERY_DEDUPE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const recent = await store.getBriefings({ limit: 40 });
  const ids = new Set<string>();
  for (const b of recent) {
    if (b.generatedAt < cutoff) continue;
    if (!b.surfacedClusterIds) continue;
    try {
      const parsed = JSON.parse(b.surfacedClusterIds);
      if (Array.isArray(parsed)) for (const id of parsed) ids.add(String(id));
    } catch {
      // Ignore malformed history rather than failing generation.
    }
  }
  return ids;
}

/**
 * Select the periphery tier: the two-gate serendipity valve. Candidates are
 * off-track groups; an item is admitted only if it is globally important AND
 * sits in the serendipity band (relevant enough to matter, novel enough that it
 * isn't a tracked topic), then deduped against CORE and recent briefs and
 * hard-capped. Always logs why candidates failed so the empty case is legible.
 */
function selectPeriphery(
  offTrack: StoryGroup[],
  trackVectors: number[][],
  coreClusterIds: Set<string>,
  surfaced: Set<string>,
  startN: number,
): PeripheryEntry[] {
  // No track interest vectors → no novelty signal is computable. Skip rather
  // than admit noise (the critique's "track must carry a search string" point).
  if (trackVectors.length === 0) {
    console.log(
      "[Brief] Periphery skipped: no track interest vectors (no search-based watchlists)",
    );
    return [];
  }

  let failImportance = 0;
  let failBand = 0;
  let failDedupe = 0;
  const scored: { group: StoryGroup; similarity: number }[] = [];

  for (const g of offTrack) {
    const importance = g.maxPriority;
    if (importance < PERIPHERY_IMPORTANCE_FLOOR) {
      failImportance++;
      continue;
    }
    const sim = trackSimilarity(g, trackVectors);
    // Serendipity band: above the relevance floor, below the CORE ceiling.
    if (sim < PERIPHERY_RELEVANCE_FLOOR || sim >= WATCHLIST_SIM_THRESHOLD) {
      failBand++;
      continue;
    }
    const cid = groupClusterId(g);
    if (coreClusterIds.has(cid) || surfaced.has(cid)) {
      failDedupe++;
      continue;
    }
    scored.push({ group: g, similarity: sim });
  }

  scored.sort((a, b) => b.group.maxPriority - a.group.maxPriority);
  const chosen = scored.slice(0, PERIPHERY_CAP);

  console.log(
    `[Brief] Periphery: ${offTrack.length} off-track candidates → ${chosen.length} admitted ` +
      `(failed: importance<${PERIPHERY_IMPORTANCE_FLOOR}=${failImportance}, ` +
      `band[${PERIPHERY_RELEVANCE_FLOOR}-${WATCHLIST_SIM_THRESHOLD})=${failBand}, deduped=${failDedupe})`,
  );

  return chosen.map((c, i) => ({
    n: startN + i,
    group: c.group,
    similarity: c.similarity,
  }));
}

const SYSTEM_PROMPT = `You are drafting an AI-industry intelligence brief that a human editor will review, edit into their own voice, and approve before it sends. For each numbered item you are given, write exactly one line in this form:

[n] <one-line WHAT — what happened, factual> **Why it matters:** <the implication: why this matters to someone tracking this topic, or what it changes> (Yes, but: <one caveat, only if warranted>)

Hard rules:
- Ground every word ONLY in the provided text for that item. Never introduce facts, numbers, model names, dates, or claims that are not in the provided text.
- If the provided text is too thin to support a real implication, write the WHAT and then exactly: **Why it matters:** (needs your take) — do not invent one.
- Keep each line tight. Lead with the implication's substance, not hype.
- Output ONLY the numbered lines, one per item, nothing else. No headers, no preamble, no sign-off. Preserve the [n] markers exactly.`;

interface PromptItem {
  n: number;
  tier: "CORE" | "PERIPHERY";
  track: string;
  sources: string;
  title: string;
  excerpt: string;
}

/** Ask Bedrock to draft the per-item implication lines; returns a map n -> line. */
async function draftImplications(
  items: PromptItem[],
): Promise<Map<number, string>> {
  const list = items
    .map(
      (it) =>
        `[${it.n}] (${it.tier}${it.track ? `, track: ${it.track}` : ""}) sources: ${it.sources}\n` +
        `title: ${it.title}\n` +
        `text: ${it.excerpt || "(no description provided)"}`,
    )
    .join("\n\n");

  const userPrompt = `Draft the implication line for each of these ${items.length} items:\n\n${list}`;

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text: string | undefined = responseBody.content?.[0]?.text;
  const byN = new Map<number, string>();
  if (!text) return byN;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^\[(\d+)\]\s*(.*)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && m[2]) byN.set(n, m[2].trim());
    }
  }
  return byN;
}

/** Truncate a description to the excerpt budget on a word boundary. */
function excerpt(item: FeedItem): string {
  const text = (item.description ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= SOURCE_EXCERPT_CHARS) return text;
  return text.slice(0, SOURCE_EXCERPT_CHARS).replace(/\s+\S*$/, "") + "…";
}

function subjectFrom(kind: BriefKind, leadTitle: string | null): string {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = kind === "weekly_heavy" ? "Weekly AI brief" : "AI brief";
  if (!leadTitle) return `${prefix} — ${date}`;
  const trimmed =
    leadTitle.length > 110 ? leadTitle.slice(0, 110).replace(/\s+\S*$/, "") + "…" : leadTitle;
  return `${prefix}: ${trimmed}`;
}

const FOOTER =
  "How this brief is made: every item is selected and reviewed by a human editor before sending. " +
  "Implications are drafted with AI assistance from the linked primary sources only, then edited. " +
  "Every claim links to its source below — no source, no claim.";

/**
 * Generate a two-tier brief as a DRAFT (awaiting the owner's review). Tags the
 * window's story groups against the owner's watchlists/tracks (CORE) and runs
 * the periphery valve over the rest, asks Bedrock to draft per-item
 * implications, assembles a server-structured plain-text body with a source
 * legend and methodology footer, and stores it as a draft briefing. Returns the
 * stored briefing, or null when there is nothing worth a brief.
 */
export async function generateBrief(
  kind: BriefKind,
  store: IStorage = storage,
) {
  const shape = SHAPES[kind];
  try {
    const result = await store.getFeedItems({
      sinceHours: shape.windowHours,
      sort: "priority",
      limit: shape.candidateLimit,
    });
    const groups = buildGroups(result.items);
    if (groups.length === 0) {
      console.log(`[Brief] ${kind}: no items in window`);
      return null;
    }

    const watchlists = await store.getWatchlists();
    const embeddingsById = await getWatchlistEmbeddings(watchlists);
    const trackVectors = Array.from(embeddingsById.values());

    // ── CORE: groups that hit a track, grouped by their primary track ──
    const coreByTrack = new Map<string, StoryGroup[]>();
    const offTrack: StoryGroup[] = [];
    for (const g of groups) {
      const track = primaryTrack(g, watchlists, embeddingsById);
      if (track) {
        const bucket = coreByTrack.get(track.name);
        if (bucket) bucket.push(g);
        else coreByTrack.set(track.name, [g]);
      } else {
        offTrack.push(g);
      }
    }

    // Rank within each track by priority, then cap total CORE entries while
    // keeping at least the top item of every track that fired.
    for (const bucket of Array.from(coreByTrack.values())) {
      bucket.sort((a, b) => b.maxPriority - a.maxPriority);
    }
    const orderedTracks = Array.from(coreByTrack.entries()).sort(
      (a, b) => (b[1][0]?.maxPriority ?? 0) - (a[1][0]?.maxPriority ?? 0),
    );

    const core: CoreEntry[] = [];
    let n = 1;
    // First pass: one guaranteed item per track (within-track top).
    for (const [trackName, bucket] of orderedTracks) {
      if (core.length >= shape.maxCore) break;
      core.push({ n: n++, group: bucket[0], trackName });
    }
    // Second pass: fill remaining CORE slots by priority across tracks.
    const remaining: { group: StoryGroup; trackName: string }[] = [];
    for (const [trackName, bucket] of orderedTracks) {
      for (const g of bucket.slice(1)) remaining.push({ group: g, trackName });
    }
    remaining.sort((a, b) => b.group.maxPriority - a.group.maxPriority);
    for (const r of remaining) {
      if (core.length >= shape.maxCore) break;
      core.push({ n: n++, group: r.group, trackName: r.trackName });
    }

    const coreClusterIds = new Set(core.map((c) => groupClusterId(c.group)));
    const surfaced = await recentlySurfaced(store);

    // ── PERIPHERY: the two-gate valve over the off-track remainder ──
    const periphery = selectPeriphery(
      offTrack,
      trackVectors,
      coreClusterIds,
      surfaced,
      n,
    );

    if (core.length === 0 && periphery.length === 0) {
      console.log(`[Brief] ${kind}: nothing matched a track or cleared periphery`);
      return null;
    }

    // ── Draft the per-item implications via Bedrock ──
    const promptItems: PromptItem[] = [
      ...core.map((c) => ({
        n: c.n,
        tier: "CORE" as const,
        track: c.trackName,
        sources: c.group.items.map((i) => i.sourceLabel).join(", "),
        title: c.group.items.map((i) => i.title).join(" | "),
        excerpt: excerpt(c.group.representative),
      })),
      ...periphery.map((p) => ({
        n: p.n,
        tier: "PERIPHERY" as const,
        track: "",
        sources: p.group.items.map((i) => i.sourceLabel).join(", "),
        title: p.group.representative.title,
        excerpt: excerpt(p.group.representative),
      })),
    ];

    let implications = new Map<number, string>();
    try {
      implications = await draftImplications(promptItems);
    } catch (err) {
      console.error("[Brief] Implication drafting failed:", (err as Error).message);
      // Degrade gracefully: the human still gets the structure + links to fill.
    }

    const lineFor = (n: number, fallbackTitle: string): string => {
      const drafted = implications.get(n);
      if (drafted) return `[${n}] ${drafted}`;
      return `[${n}] ${fallbackTitle} **Why it matters:** (needs your take)`;
    };

    // ── Assemble the server-structured body ──
    const parts: string[] = [];
    const leadTitle = core[0]?.group.representative.title
      ?? periphery[0]?.group.representative.title
      ?? null;

    // CORE sections grouped by track, in track-priority order.
    const coreByTrackName = new Map<string, CoreEntry[]>();
    for (const c of core) {
      const b = coreByTrackName.get(c.trackName);
      if (b) b.push(c);
      else coreByTrackName.set(c.trackName, [c]);
    }
    for (const [trackName] of orderedTracks) {
      const entries = coreByTrackName.get(trackName);
      if (!entries || entries.length === 0) continue;
      parts.push(`## CORE — ${trackName}`);
      for (const c of entries) {
        parts.push(lineFor(c.n, c.group.representative.title));
      }
    }

    if (periphery.length > 0) {
      parts.push("## PERIPHERY — you didn't ask, but you'd want to know");
      for (const p of periphery) {
        parts.push(lineFor(p.n, p.group.representative.title));
      }
    } else {
      parts.push("## PERIPHERY — you didn't ask, but you'd want to know");
      parts.push("Nothing off your tracks cleared the bar today.");
    }

    // Server-built source legend: one line per selected group representative so
    // links are never model-fabricated. Numbering spans CORE then PERIPHERY.
    parts.push("## SOURCES");
    const allEntries: { n: number; group: StoryGroup }[] = [
      ...core.map((c) => ({ n: c.n, group: c.group })),
      ...periphery.map((p) => ({ n: p.n, group: p.group })),
    ].sort((a, b) => a.n - b.n);
    for (const e of allEntries) {
      parts.push(
        `[${e.n}] ${e.group.representative.title} — ${e.group.representative.url ?? "no link"}`,
      );
    }

    parts.push(`## ABOUT`);
    parts.push(FOOTER);

    const content = parts.join("\n");
    const surfacedIds = allEntries.map((e) => groupClusterId(e.group));

    const briefing = await store.createBriefing({
      content,
      itemCount: allEntries.length,
      generatedAt: new Date().toISOString(),
      kind,
      status: "draft",
      subject: subjectFrom(kind, leadTitle),
      surfacedClusterIds: JSON.stringify(surfacedIds),
    });

    console.log(
      `[Brief] ${kind} draft: ${core.length} core across ${coreByTrack.size} tracks, ` +
        `${periphery.length} periphery (${content.length} chars)`,
    );
    return briefing;
  } catch (err) {
    console.error(`[Brief] ${kind} generation failed:`, (err as Error).message);
    return null;
  }
}
