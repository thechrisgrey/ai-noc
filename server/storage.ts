import { type FeedItem, type InsertFeedItem, type Bookmark, type InsertBookmark, type Watchlist, type InsertWatchlist, type Briefing, type InsertBriefing, type Source, type InsertSource, feedItems, bookmarks, watchlists, briefings, sources } from "@shared/schema";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, ne, desc, asc, ilike, or, and, lt, lte, gte, count, sql, inArray, isNull } from "drizzle-orm";

/** Escape LIKE-special characters so they are treated as literals */
function escapeLike(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Serialize a number[] into the pgvector text literal: '[1,2,3]'. */
function toVectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

/**
 * Map raw rows from a `sql` execute (snake_case, driver-dependent envelope)
 * onto FeedItem. Used by the vector queries, which can't go through the typed
 * query builder because of the `<=>` distance projection.
 */
function mapVectorRows(result: unknown): FeedItem[] {
  const rows: any[] = (result as any).rows ?? (result as any) ?? [];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    url: r.url,
    source: r.source,
    sourceLabel: r.source_label,
    category: r.category,
    publishedAt: r.published_at,
    fetchedAt: r.fetched_at,
    guid: r.guid,
    isBreaking: r.is_breaking,
    imageUrl: r.image_url,
    clusterId: r.cluster_id,
    priority: r.priority,
    readAt: r.read_at,
    embedding: r.embedding,
  }));
}

interface PriorityCursor {
  p: number;
  t: string;
  id: number;
}

interface TimeCursor {
  t: string;
  id: number;
}

/** Opaque keyset cursor for priority-sorted pagination: (priority, publishedAt, id). */
export function encodePriorityCursor(
  item: Pick<FeedItem, "priority" | "publishedAt" | "id">,
): string {
  return Buffer.from(
    JSON.stringify({ p: item.priority, t: item.publishedAt, id: item.id }),
  ).toString("base64url");
}

export function decodePriorityCursor(s: string): PriorityCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf-8"));
    if (
      typeof parsed?.p === "number" &&
      typeof parsed?.t === "string" &&
      typeof parsed?.id === "number"
    ) {
      return { p: parsed.p, t: parsed.t, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/** Opaque keyset cursor for time-sorted pagination: (publishedAt, id). */
export function encodeTimeCursor(
  item: Pick<FeedItem, "publishedAt" | "id">,
): string {
  return Buffer.from(
    JSON.stringify({ t: item.publishedAt, id: item.id }),
  ).toString("base64url");
}

export function decodeTimeCursor(s: string): TimeCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf-8"));
    if (typeof parsed?.t === "string" && typeof parsed?.id === "number") {
      return { t: parsed.t, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function buildConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.DB_USERNAME || "postgres";
  const pass = process.env.DB_PASSWORD || "";
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "ainoc";
  return `postgresql://${user}:${pass}@${host}:${port}/${name}?sslmode=no-verify`;
}

const isAws = !!(process.env.DB_HOST || process.env.DATABASE_URL?.includes("rds.amazonaws.com"));

export interface PaginatedFeed {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface SourceIntelRow {
  source: string;
  sourceLabel: string;
  firsts: number;
  contested: number;
  medianLagSeconds: number | null;
}

export interface IStorage {
  getFeedItems(opts: {
    limit?: number;
    cursor?: string;
    category?: string;
    source?: string;
    search?: string;
    sort?: "time" | "priority";
    sinceHours?: number;
  }): Promise<PaginatedFeed>;
  getFeedItemById(id: number): Promise<FeedItem | undefined>;
  createFeedItem(item: InsertFeedItem): Promise<FeedItem>;
  feedItemExists(guid: string): Promise<boolean>;
  getBookmarks(): Promise<(Bookmark & { feedItem?: FeedItem })[]>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(feedItemId: number): Promise<void>;
  isBookmarked(feedItemId: number): Promise<boolean>;
  markRead(ids: number[]): Promise<void>;
  markAllRead(beforeISO: string): Promise<void>;
  getStats(): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    breakingCount: number;
    unreadCount: number;
  }>;
  getRecentItems(hours: number): Promise<FeedItem[]>;
  updateEmbeddings(rows: { id: number; embedding: number[] }[]): Promise<void>;
  getItemsMissingEmbeddings(limit: number): Promise<FeedItem[]>;
  searchSemantic(
    queryVec: number[],
    opts?: { limit?: number; sinceHours?: number; category?: string; source?: string },
  ): Promise<FeedItem[]>;
  getRelatedItems(id: number, limit?: number): Promise<FeedItem[]>;
  updateClusterId(id: number, clusterId: string): Promise<void>;
  updatePriority(id: number, priority: number): Promise<void>;
  updateIsBreaking(id: number, isBreaking: boolean): Promise<void>;
  bulkUpdatePriorities(rows: { id: number; priority: number; isBreaking: boolean }[]): Promise<void>;
  decayStalePriorities(hours: number, cap?: number): Promise<number>;
  bulkUpdateClusterIds(rows: { id: number; clusterId: string }[]): Promise<void>;
  getItemsByIds(ids: number[]): Promise<FeedItem[]>;
  getClusterCounts(clusterIds: string[]): Promise<Map<string, number>>;
  getClusterSiblings(id: number): Promise<FeedItem[]>;
  pruneOldItems(days: number): Promise<number>;
  getBookmarkedIds(feedItemIds: number[]): Promise<Set<number>>;
  getSourceActivity(days: number): Promise<Record<string, number[]>>;
  getSourceIntel(days: number): Promise<SourceIntelRow[]>;
  getWatchlists(): Promise<Watchlist[]>;
  createWatchlist(w: InsertWatchlist): Promise<Watchlist>;
  updateWatchlist(
    id: number,
    patch: { alert?: boolean; name?: string; lastTriggeredAt?: string },
  ): Promise<Watchlist | undefined>;
  deleteWatchlist(id: number): Promise<void>;
  getLatestBriefing(kind?: string): Promise<Briefing | undefined>;
  getBriefings(opts: { kind?: string; limit?: number }): Promise<Briefing[]>;
  createBriefing(b: InsertBriefing): Promise<Briefing>;
  getBriefingById(id: number): Promise<Briefing | undefined>;
  getLatestDraft(): Promise<Briefing | undefined>;
  claimDraftForSend(id: number): Promise<Briefing | undefined>;
  updateBriefing(
    id: number,
    patch: { content?: string; subject?: string | null; status?: string; sentAt?: string | null },
  ): Promise<Briefing | undefined>;
  getSources(enabledOnly?: boolean): Promise<Source[]>;
  getSourceSlugsBySection(section: string): Promise<string[]>;
  createSource(s: InsertSource): Promise<Source>;
  updateSource(
    id: number,
    patch: { enabled?: boolean; label?: string; defaultCategory?: string; section?: string },
  ): Promise<Source | undefined>;
  deleteSource(id: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * DatabaseStorage accepts any drizzle PG database instance. This enables:
 *   - Production: node-postgres Pool
 *   - Tests: PGlite via drizzle-orm/pglite (shares same query API)
 */
type AnyPgDb = NodePgDatabase<any> | any;

export class DatabaseStorage implements IStorage {
  constructor(
    private readonly db: AnyPgDb,
    private readonly onClose?: () => Promise<void>,
  ) {}

  async getFeedItems(opts: {
    limit?: number;
    cursor?: string;
    category?: string;
    source?: string;
    search?: string;
    sort?: "time" | "priority";
    sinceHours?: number;
  } = {}): Promise<PaginatedFeed> {
    const { limit = 30, cursor, category, source, search, sort = "time", sinceHours } = opts;
    const conditions: any[] = [];

    if (cursor) {
      if (sort === "priority") {
        const decoded = decodePriorityCursor(cursor);
        // Malformed cursors are ignored rather than failing the request.
        if (decoded) {
          conditions.push(
            or(
              lt(feedItems.priority, decoded.p),
              and(eq(feedItems.priority, decoded.p), lt(feedItems.publishedAt, decoded.t)),
              and(
                eq(feedItems.priority, decoded.p),
                eq(feedItems.publishedAt, decoded.t),
                lt(feedItems.id, decoded.id),
              ),
            ),
          );
        }
      } else {
        const decoded = decodeTimeCursor(cursor);
        if (decoded) {
          conditions.push(
            or(
              lt(feedItems.publishedAt, decoded.t),
              and(eq(feedItems.publishedAt, decoded.t), lt(feedItems.id, decoded.id)),
            ),
          );
        }
      }
    }
    if (sinceHours !== undefined) {
      const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
      conditions.push(gte(feedItems.publishedAt, cutoff));
    }
    if (category && category !== "all") {
      conditions.push(eq(feedItems.category, category));
    }
    if (source && source !== "all") {
      conditions.push(eq(feedItems.source, source));
    }
    if (search) {
      const escaped = escapeLike(search);
      conditions.push(
        or(
          ilike(feedItems.title, `%${escaped}%`),
          ilike(feedItems.description, `%${escaped}%`),
        ),
      );
    }

    const orderBy =
      sort === "priority"
        ? [desc(feedItems.priority), desc(feedItems.publishedAt), desc(feedItems.id)]
        : [desc(feedItems.publishedAt), desc(feedItems.id)];

    const query = this.db.select().from(feedItems);
    const items =
      conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(...orderBy).limit(limit)
        : await query.orderBy(...orderBy).limit(limit);

    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit
        ? sort === "priority"
          ? encodePriorityCursor(last)
          : encodeTimeCursor(last)
        : null;

    return { items, nextCursor };
  }

  async getFeedItemById(id: number): Promise<FeedItem | undefined> {
    const rows = await this.db.select().from(feedItems).where(eq(feedItems.id, id)).limit(1);
    return rows[0];
  }

  async createFeedItem(item: InsertFeedItem): Promise<FeedItem> {
    const rows = await this.db.insert(feedItems).values(item).returning();
    return rows[0];
  }

  async feedItemExists(guid: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(eq(feedItems.guid, guid))
      .limit(1);
    return rows.length > 0;
  }

  async getBookmarks(): Promise<(Bookmark & { feedItem?: FeedItem })[]> {
    const rows = await this.db
      .select()
      .from(bookmarks)
      .leftJoin(feedItems, eq(bookmarks.feedItemId, feedItems.id))
      .orderBy(desc(bookmarks.createdAt));

    return rows.map((row: any) => ({
      ...row.bookmarks,
      feedItem: row.feed_items ?? undefined,
    }));
  }

  async createBookmark(bookmark: InsertBookmark): Promise<Bookmark> {
    const rows = await this.db.insert(bookmarks).values(bookmark).returning();
    return rows[0];
  }

  async deleteBookmark(feedItemId: number): Promise<void> {
    await this.db.delete(bookmarks).where(eq(bookmarks.feedItemId, feedItemId));
  }

  async isBookmarked(feedItemId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(eq(bookmarks.feedItemId, feedItemId))
      .limit(1);
    return rows.length > 0;
  }

  async markRead(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(feedItems)
      .set({ readAt: new Date().toISOString() })
      .where(inArray(feedItems.id, ids));
  }

  async markAllRead(beforeISO: string): Promise<void> {
    await this.db
      .update(feedItems)
      .set({ readAt: new Date().toISOString() })
      .where(and(isNull(feedItems.readAt), lte(feedItems.publishedAt, beforeISO)));
  }

  async getStats(): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    breakingCount: number;
    unreadCount: number;
  }> {
    const [totalRow] = await this.db.select({ value: count() }).from(feedItems);
    const total = totalRow.value;

    const catRows = await this.db
      .select({ category: feedItems.category, value: count() })
      .from(feedItems)
      .groupBy(feedItems.category);
    const byCategory: Record<string, number> = {};
    for (const r of catRows) byCategory[r.category] = r.value;

    const srcRows = await this.db
      .select({ source: feedItems.source, value: count() })
      .from(feedItems)
      .groupBy(feedItems.source);
    const bySource: Record<string, number> = {};
    for (const r of srcRows) bySource[r.source] = r.value;

    const [breakingRow] = await this.db
      .select({ value: count() })
      .from(feedItems)
      .where(eq(feedItems.isBreaking, true));
    const breakingCount = breakingRow.value;

    const [unreadRow] = await this.db
      .select({ value: count() })
      .from(feedItems)
      .where(isNull(feedItems.readAt));
    const unreadCount = unreadRow.value;

    return { total, byCategory, bySource, breakingCount, unreadCount };
  }

  async getRecentItems(hours: number): Promise<FeedItem[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return await this.db
      .select()
      .from(feedItems)
      .where(sql`${feedItems.publishedAt} >= ${cutoff}`)
      .orderBy(desc(feedItems.publishedAt));
  }

  async updateEmbeddings(
    rows: { id: number; embedding: number[] }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const values = sql.join(
      rows.map(
        (r) => sql`(${r.id}::int, ${toVectorLiteral(r.embedding)}::vector)`,
      ),
      sql`, `,
    );
    await this.db.execute(sql`
      UPDATE ${feedItems} AS f
      SET embedding = v.embedding
      FROM (VALUES ${values}) AS v(id, embedding)
      WHERE f.id = v.id
    `);
  }

  async getItemsMissingEmbeddings(limit: number): Promise<FeedItem[]> {
    return await this.db
      .select()
      .from(feedItems)
      .where(isNull(feedItems.embedding))
      .orderBy(desc(feedItems.id))
      .limit(limit);
  }

  async searchSemantic(
    queryVec: number[],
    opts: { limit?: number; sinceHours?: number; category?: string; source?: string } = {},
  ): Promise<FeedItem[]> {
    const { limit = 30, sinceHours, category, source } = opts;
    const literal = toVectorLiteral(queryVec);
    const since =
      sinceHours !== undefined
        ? sql` AND published_at >= ${new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString()}`
        : sql``;
    // Equality filters mirror the lexical path so an active category/source
    // chip constrains semantic results instead of being silently ignored.
    const catFilter =
      category && category !== "all" ? sql` AND category = ${category}` : sql``;
    const srcFilter =
      source && source !== "all" ? sql` AND source = ${source}` : sql``;
    const result = await this.db.execute(sql`
      SELECT *, embedding <=> ${literal}::vector AS distance
      FROM ${feedItems}
      WHERE embedding IS NOT NULL${since}${catFilter}${srcFilter}
      ORDER BY distance ASC
      LIMIT ${limit}
    `);
    return mapVectorRows(result);
  }

  async getRelatedItems(id: number, limit = 5): Promise<FeedItem[]> {
    const source = await this.getFeedItemById(id);
    if (!source?.embedding) return [];
    const literal = toVectorLiteral(source.embedding as unknown as number[]);
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const clusterFilter = source.clusterId
      ? sql` AND (cluster_id IS DISTINCT FROM ${source.clusterId})`
      : sql``;
    const result = await this.db.execute(sql`
      SELECT *, embedding <=> ${literal}::vector AS distance
      FROM ${feedItems}
      WHERE embedding IS NOT NULL
        AND id <> ${id}
        AND published_at >= ${cutoff}${clusterFilter}
      ORDER BY distance ASC
      LIMIT ${limit}
    `);
    return mapVectorRows(result);
  }

  async updateClusterId(id: number, clusterId: string): Promise<void> {
    await this.db.update(feedItems).set({ clusterId }).where(eq(feedItems.id, id));
  }

  async updatePriority(id: number, priority: number): Promise<void> {
    await this.db.update(feedItems).set({ priority }).where(eq(feedItems.id, id));
  }

  async updateIsBreaking(id: number, isBreaking: boolean): Promise<void> {
    await this.db.update(feedItems).set({ isBreaking }).where(eq(feedItems.id, id));
  }

  async bulkUpdatePriorities(
    rows: { id: number; priority: number; isBreaking: boolean }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const values = sql.join(
      rows.map(
        (r) =>
          sql`(${r.id}::int, ${r.priority}::int, ${r.isBreaking}::boolean)`,
      ),
      sql`, `,
    );
    await this.db.execute(sql`
      UPDATE ${feedItems} AS f
      SET priority = v.priority, is_breaking = v.is_breaking
      FROM (VALUES ${values}) AS v(id, priority, is_breaking)
      WHERE f.id = v.id
    `);
  }

  async decayStalePriorities(hours: number, cap = 50): Promise<number> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const result = await this.db.execute(sql`
      UPDATE ${feedItems}
      SET is_breaking = false, priority = LEAST(priority, ${cap}::int)
      WHERE published_at < ${cutoff}
        AND (is_breaking = true OR priority > ${cap}::int)
    `);
    // node-postgres reports rowCount; PGlite reports affectedRows.
    return (result as any).rowCount ?? (result as any).affectedRows ?? 0;
  }

  async bulkUpdateClusterIds(
    rows: { id: number; clusterId: string }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const values = sql.join(
      rows.map((r) => sql`(${r.id}::int, ${r.clusterId}::text)`),
      sql`, `,
    );
    await this.db.execute(sql`
      UPDATE ${feedItems} AS f
      SET cluster_id = v.cluster_id
      FROM (VALUES ${values}) AS v(id, cluster_id)
      WHERE f.id = v.id
    `);
  }

  async getItemsByIds(ids: number[]): Promise<FeedItem[]> {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(feedItems)
      .where(inArray(feedItems.id, ids));
  }

  async getClusterCounts(clusterIds: string[]): Promise<Map<string, number>> {
    if (clusterIds.length === 0) return new Map();
    // Match clustering's 72h window (clusterRecentItems) so the "+N SOURCES"
    // coverage badge agrees with getCoverageCount instead of counting stale
    // members that retain a cluster_id past the window until pruned.
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const rows = await this.db
      .select({ clusterId: feedItems.clusterId, value: count() })
      .from(feedItems)
      .where(and(inArray(feedItems.clusterId, clusterIds), gte(feedItems.publishedAt, cutoff)))
      .groupBy(feedItems.clusterId);
    return new Map(
      rows.map((r: { clusterId: string | null; value: number }) => [
        r.clusterId as string,
        Number(r.value),
      ]),
    );
  }

  async getClusterSiblings(id: number): Promise<FeedItem[]> {
    const item = await this.getFeedItemById(id);
    if (!item?.clusterId) return [];
    // Same 72h window as getClusterCounts so the expanded sibling list stays
    // consistent with the coverage count shown on the card.
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    return await this.db
      .select()
      .from(feedItems)
      .where(
        and(
          eq(feedItems.clusterId, item.clusterId),
          ne(feedItems.id, id),
          gte(feedItems.publishedAt, cutoff),
        ),
      )
      .orderBy(asc(feedItems.publishedAt));
  }

  async pruneOldItems(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db.execute(sql`
      DELETE FROM ${feedItems}
      WHERE published_at < ${cutoff}
        AND id NOT IN (SELECT feed_item_id FROM ${bookmarks})
    `);
    // node-postgres reports rowCount; PGlite reports affectedRows.
    return (result as any).rowCount ?? (result as any).affectedRows ?? 0;
  }

  async getBookmarkedIds(feedItemIds: number[]): Promise<Set<number>> {
    if (feedItemIds.length === 0) return new Set();
    const rows = await this.db
      .select({ feedItemId: bookmarks.feedItemId })
      .from(bookmarks)
      .where(inArray(bookmarks.feedItemId, feedItemIds));
    return new Set(rows.map((r: { feedItemId: number }) => r.feedItemId));
  }

  async getSourceActivity(days: number): Promise<Record<string, number[]>> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const totalHours = days * 24;

    const rows = await this.db.execute(
      sql`SELECT ${feedItems.source} as source,
            date_trunc('hour', ${feedItems.publishedAt}::timestamp) as hour,
            COUNT(*)::int as count
          FROM ${feedItems}
          WHERE ${feedItems.publishedAt} > ${cutoff}
          GROUP BY ${feedItems.source}, hour
          ORDER BY hour`
    );

    const rawRows: any[] = (rows as any).rows ?? (rows as any);

    const sourceHourMap: Record<string, Record<string, number>> = {};
    for (const row of rawRows) {
      const source = row.source as string;
      const hour = new Date(row.hour as string).toISOString();
      const cnt = Number(row.count);
      if (!sourceHourMap[source]) sourceHourMap[source] = {};
      sourceHourMap[source][hour] = cnt;
    }

    const startHour = new Date(cutoff);
    startHour.setMinutes(0, 0, 0);
    const buckets: string[] = [];
    for (let i = 0; i < totalHours; i++) {
      const h = new Date(startHour.getTime() + i * 60 * 60 * 1000);
      buckets.push(h.toISOString());
    }

    const result: Record<string, number[]> = {};
    for (const source of Object.keys(sourceHourMap)) {
      result[source] = buckets.map((b) => sourceHourMap[source][b] || 0);
    }

    return result;
  }

  // First-mover leaderboard: within each multi-source story cluster, credit the
  // source(s) that published at the earliest timestamp as the "first", and
  // measure how far behind the rest trailed (median lag, in seconds).
  async getSourceIntel(days: number): Promise<SourceIntelRow[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.db.execute(sql`
      WITH clustered AS (
        SELECT source, source_label, published_at,
               MIN(published_at) OVER (PARTITION BY cluster_id) AS cluster_first,
               COUNT(*) OVER (PARTITION BY cluster_id) AS cluster_size
        FROM ${feedItems}
        WHERE cluster_id IS NOT NULL AND published_at > ${cutoff}
      )
      SELECT source,
             MAX(source_label) AS source_label,
             COUNT(*) FILTER (WHERE cluster_size > 1 AND published_at = cluster_first) AS firsts,
             COUNT(*) FILTER (WHERE cluster_size > 1) AS contested,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (published_at::timestamptz - cluster_first::timestamptz)))
               FILTER (WHERE cluster_size > 1 AND published_at > cluster_first) AS median_lag_seconds
      FROM clustered
      GROUP BY source
      HAVING COUNT(*) FILTER (WHERE cluster_size > 1) > 0
      ORDER BY firsts DESC
    `);

    const rawRows: any[] = (rows as any).rows ?? (rows as any);
    return rawRows.map((r) => ({
      source: r.source as string,
      sourceLabel: r.source_label as string,
      firsts: Number(r.firsts),
      contested: Number(r.contested),
      medianLagSeconds: r.median_lag_seconds == null ? null : Number(r.median_lag_seconds),
    }));
  }

  async getWatchlists(): Promise<Watchlist[]> {
    return await this.db.select().from(watchlists).orderBy(desc(watchlists.createdAt));
  }

  async createWatchlist(w: InsertWatchlist): Promise<Watchlist> {
    const rows = await this.db.insert(watchlists).values(w).returning();
    return rows[0];
  }

  async updateWatchlist(
    id: number,
    patch: { alert?: boolean; name?: string; lastTriggeredAt?: string },
  ): Promise<Watchlist | undefined> {
    const set: Partial<InsertWatchlist> = {};
    if (patch.alert !== undefined) set.alert = patch.alert;
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.lastTriggeredAt !== undefined) set.lastTriggeredAt = patch.lastTriggeredAt;
    if (Object.keys(set).length === 0) {
      const rows = await this.db.select().from(watchlists).where(eq(watchlists.id, id)).limit(1);
      return rows[0];
    }
    const rows = await this.db.update(watchlists).set(set).where(eq(watchlists.id, id)).returning();
    return rows[0];
  }

  async deleteWatchlist(id: number): Promise<void> {
    await this.db.delete(watchlists).where(eq(watchlists.id, id));
  }

  async getLatestBriefing(kind?: string): Promise<Briefing | undefined> {
    const base = this.db.select().from(briefings);
    const query = kind ? base.where(eq(briefings.kind, kind)) : base;
    const rows = await query.orderBy(desc(briefings.generatedAt)).limit(1);
    return rows[0];
  }

  async getBriefings(opts: { kind?: string; limit?: number } = {}): Promise<Briefing[]> {
    const { kind, limit = 20 } = opts;
    const base = this.db.select().from(briefings);
    const query = kind ? base.where(eq(briefings.kind, kind)) : base;
    return await query.orderBy(desc(briefings.generatedAt)).limit(limit);
  }

  async createBriefing(b: InsertBriefing): Promise<Briefing> {
    const rows = await this.db.insert(briefings).values(b).returning();
    return rows[0];
  }

  async getBriefingById(id: number): Promise<Briefing | undefined> {
    const rows = await this.db.select().from(briefings).where(eq(briefings.id, id)).limit(1);
    return rows[0];
  }

  /** Latest two-tier brief awaiting the owner's review (the approval queue). */
  async getLatestDraft(): Promise<Briefing | undefined> {
    const rows = await this.db
      .select()
      .from(briefings)
      .where(
        and(
          eq(briefings.status, "draft"),
          inArray(briefings.kind, ["daily_skim", "weekly_heavy"]),
        ),
      )
      .orderBy(desc(briefings.generatedAt))
      .limit(1);
    return rows[0];
  }

  /**
   * Atomically claim a draft for sending: transition draft → 'sending' only if
   * it is still a draft, returning the fresh row. A concurrent claim or an
   * already-sent brief returns undefined. This single compare-and-swap closes
   * both the double-send race and the edit-after-approval race (the edit guard
   * rejects any non-'draft' status, so a claimed brief can no longer be edited).
   */
  async claimDraftForSend(id: number): Promise<Briefing | undefined> {
    const rows = await this.db
      .update(briefings)
      .set({ status: "sending" })
      .where(and(eq(briefings.id, id), eq(briefings.status, "draft")))
      .returning();
    return rows[0];
  }

  async updateBriefing(
    id: number,
    patch: { content?: string; subject?: string | null; status?: string; sentAt?: string | null },
  ): Promise<Briefing | undefined> {
    const set: Partial<InsertBriefing> = {};
    if (patch.content !== undefined) set.content = patch.content;
    if (patch.subject !== undefined) set.subject = patch.subject;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.sentAt !== undefined) set.sentAt = patch.sentAt;
    if (Object.keys(set).length === 0) {
      return this.getBriefingById(id);
    }
    const rows = await this.db.update(briefings).set(set).where(eq(briefings.id, id)).returning();
    return rows[0];
  }

  async getSources(enabledOnly = false): Promise<Source[]> {
    const query = this.db.select().from(sources);
    return enabledOnly
      ? await query.where(eq(sources.enabled, true)).orderBy(asc(sources.id))
      : await query.orderBy(asc(sources.id));
  }

  async getSourceSlugsBySection(section: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: sources.slug })
      .from(sources)
      .where(eq(sources.section, section));
    return rows.map((r: { slug: string }) => r.slug);
  }

  async createSource(s: InsertSource): Promise<Source> {
    const rows = await this.db.insert(sources).values(s).returning();
    return rows[0];
  }

  async updateSource(
    id: number,
    patch: { enabled?: boolean; label?: string; defaultCategory?: string; section?: string },
  ): Promise<Source | undefined> {
    const set: Partial<InsertSource> = {};
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.defaultCategory !== undefined) set.defaultCategory = patch.defaultCategory;
    if (patch.section !== undefined) set.section = patch.section;
    if (Object.keys(set).length === 0) {
      const rows = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
      return rows[0];
    }
    const rows = await this.db.update(sources).set(set).where(eq(sources.id, id)).returning();
    return rows[0];
  }

  async deleteSource(id: number): Promise<void> {
    await this.db.delete(sources).where(eq(sources.id, id));
  }

  async close(): Promise<void> {
    if (this.onClose) await this.onClose();
  }
}

// ─── Default production storage ────────────────────────────
// Lazily constructed so test setup can override by importing DatabaseStorage directly.

let _defaultPool: Pool | null = null;
let _defaultStorage: DatabaseStorage | null = null;

function getDefaultStorage(): DatabaseStorage {
  if (!_defaultStorage) {
    _defaultPool = new Pool({
      connectionString: buildConnectionString(),
      max: 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: isAws ? { rejectUnauthorized: false } : false,
    });
    _defaultPool.on("error", (err) => {
      console.error("[DB] Pool error:", err.message);
    });
    const db = drizzle(_defaultPool);
    _defaultStorage = new DatabaseStorage(db, async () => {
      if (_defaultPool) await _defaultPool.end();
    });
  }
  return _defaultStorage;
}

// Proxy the module export so consumers keep `import { storage } from "./storage"`.
export const storage: IStorage = new Proxy({} as IStorage, {
  get(_target, prop) {
    const inst = getDefaultStorage() as any;
    const value = inst[prop];
    return typeof value === "function" ? value.bind(inst) : value;
  },
});
