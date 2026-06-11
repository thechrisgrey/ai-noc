import type { FeedItem, Watchlist } from "@shared/schema";
import { cosineSim, embedText, toVector } from "./embeddings";

// Cosine threshold above which a watchlist's semantic query is considered a hit
// against an item embedding. Slightly stricter than the clustering threshold so
// alerts stay precise rather than catching loosely related stories.
export const WATCHLIST_SIM_THRESHOLD = 0.78;

/**
 * Does a single item satisfy a watchlist's filters? AND across the set fields:
 *   - category: exact equality when set
 *   - source: exact equality when set
 *   - search: case-insensitive substring on title+description, OR (when a query
 *     embedding and the item embedding are both present) cosine similarity above
 *     the threshold
 * A watchlist with no filters set never matches (avoids alerting on everything).
 */
export function matchesWatchlist(
  item: FeedItem,
  wl: Watchlist,
  wlEmbedding?: number[],
): boolean {
  let hasFilter = false;

  if (wl.category) {
    hasFilter = true;
    if (item.category !== wl.category) return false;
  }
  if (wl.source) {
    hasFilter = true;
    if (item.source !== wl.source) return false;
  }
  if (wl.search && wl.search.trim()) {
    hasFilter = true;
    const needle = wl.search.toLowerCase();
    const haystack = `${item.title} ${item.description ?? ""}`.toLowerCase();
    const lexicalHit = haystack.includes(needle);
    // toVector handles both the array form (Drizzle query builder) and the
    // pgvector text-literal form (raw-SQL paths) so a semantic hit can't be
    // silently dropped just because of how the row was loaded.
    const itemEmbedding = toVector(item.embedding);
    const semanticHit =
      !lexicalHit &&
      Array.isArray(wlEmbedding) &&
      itemEmbedding !== null &&
      cosineSim(wlEmbedding, itemEmbedding) > WATCHLIST_SIM_THRESHOLD;
    if (!lexicalHit && !semanticHit) return false;
  }

  return hasFilter;
}

/**
 * Evaluate a batch of new items against a set of watchlists, returning the items
 * that hit each watchlist. Watchlists with no hits are omitted from the map.
 */
export function evaluateWatchlists(
  newItems: FeedItem[],
  watchlists: Watchlist[],
  embeddingsByWatchlistId: Map<number, number[]>,
): Map<number, FeedItem[]> {
  const hits = new Map<number, FeedItem[]>();
  for (const wl of watchlists) {
    const wlEmbedding = embeddingsByWatchlistId.get(wl.id);
    const matched = newItems.filter((item) => matchesWatchlist(item, wl, wlEmbedding));
    if (matched.length > 0) hits.set(wl.id, matched);
  }
  return hits;
}

// ─── Query embedding cache ─────────────────────────────────────────
// Lazily embed each watchlist's search text, keyed by id + the exact search
// string so an edited search re-embeds. Cleared wholesale on any watchlist
// mutation (create/update/delete) from the routes layer.

const watchlistEmbedCache = new Map<string, number[]>();

function cacheKey(id: number, search: string): string {
  return `${id}::${search}`;
}

/**
 * Resolve query embeddings for alert-enabled watchlists that carry a search
 * string. Populates the in-process cache lazily; embed failures are skipped
 * (the watchlist still matches lexically). Returns a map of id -> vector.
 */
export async function getWatchlistEmbeddings(
  watchlists: Watchlist[],
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  for (const wl of watchlists) {
    const search = wl.search?.trim();
    if (!search) continue;
    const key = cacheKey(wl.id, search);
    let vec = watchlistEmbedCache.get(key);
    if (!vec) {
      const embedded = await embedText(search);
      if (embedded) {
        vec = embedded;
        watchlistEmbedCache.set(key, embedded);
      }
    }
    if (vec) result.set(wl.id, vec);
  }
  return result;
}

/** Drop all cached watchlist query embeddings (call on any watchlist mutation). */
export function clearWatchlistEmbeddingCache(): void {
  watchlistEmbedCache.clear();
}
