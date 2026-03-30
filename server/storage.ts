import { type FeedItem, type InsertFeedItem, type Bookmark, type InsertBookmark, type Watchlist, type InsertWatchlist, type Briefing, type InsertBriefing, feedItems, bookmarks, watchlists, briefings } from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, desc, like, or, and, lt, count, sql, inArray } from "drizzle-orm";

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

const pool = new Pool({
  connectionString: buildConnectionString(),
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: isAws ? { rejectUnauthorized: false } : false,
});

// Log connection errors instead of crashing
pool.on("error", (err) => {
  console.error("[DB] Pool error:", err.message);
});

export const db = drizzle(pool);

export interface PaginatedFeed {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface IStorage {
  getFeedItems(opts: {
    limit?: number;
    cursor?: string;
    category?: string;
    source?: string;
    search?: string;
    sort?: "time" | "priority";
  }): Promise<PaginatedFeed>;
  getFeedItemById(id: number): Promise<FeedItem | undefined>;
  createFeedItem(item: InsertFeedItem): Promise<FeedItem>;
  feedItemExists(guid: string): Promise<boolean>;
  getBookmarks(): Promise<(Bookmark & { feedItem?: FeedItem })[]>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(feedItemId: number): Promise<void>;
  isBookmarked(feedItemId: number): Promise<boolean>;
  getStats(): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    breakingCount: number;
  }>;
  getRecentItems(hours: number): Promise<FeedItem[]>;
  updateClusterId(id: number, clusterId: string): Promise<void>;
  updatePriority(id: number, priority: number): Promise<void>;
  updateIsBreaking(id: number, isBreaking: boolean): Promise<void>;
  getItemsByIds(ids: number[]): Promise<FeedItem[]>;
  getBookmarkedIds(feedItemIds: number[]): Promise<Set<number>>;
  getSourceActivity(days: number): Promise<Record<string, number[]>>;
  getWatchlists(): Promise<Watchlist[]>;
  createWatchlist(w: InsertWatchlist): Promise<Watchlist>;
  deleteWatchlist(id: number): Promise<void>;
  getLatestBriefing(): Promise<Briefing | undefined>;
  createBriefing(b: InsertBriefing): Promise<Briefing>;
  close(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getFeedItems(opts: {
    limit?: number;
    cursor?: string;
    category?: string;
    source?: string;
    search?: string;
    sort?: "time" | "priority";
  } = {}): Promise<PaginatedFeed> {
    const { limit = 30, cursor, category, source, search, sort = "time" } = opts;
    const conditions: any[] = [];

    if (cursor) {
      conditions.push(lt(feedItems.publishedAt, cursor));
    }
    if (category && category !== "all") {
      conditions.push(eq(feedItems.category, category));
    }
    if (source && source !== "all") {
      conditions.push(eq(feedItems.source, source));
    }
    if (search) {
      conditions.push(
        or(
          like(feedItems.title, `%${search}%`),
          like(feedItems.description, `%${search}%`),
        ),
      );
    }

    const orderBy =
      sort === "priority"
        ? [desc(feedItems.priority), desc(feedItems.publishedAt)]
        : [desc(feedItems.publishedAt)];

    const query = db.select().from(feedItems);
    const items =
      conditions.length > 0
        ? await query.where(and(...conditions)).orderBy(...orderBy).limit(limit)
        : await query.orderBy(...orderBy).limit(limit);

    const nextCursor =
      items.length === limit ? items[items.length - 1].publishedAt : null;

    return { items, nextCursor };
  }

  async getFeedItemById(id: number): Promise<FeedItem | undefined> {
    const rows = await db.select().from(feedItems).where(eq(feedItems.id, id)).limit(1);
    return rows[0];
  }

  async createFeedItem(item: InsertFeedItem): Promise<FeedItem> {
    const rows = await db.insert(feedItems).values(item).returning();
    return rows[0];
  }

  async feedItemExists(guid: string): Promise<boolean> {
    const rows = await db
      .select({ id: feedItems.id })
      .from(feedItems)
      .where(eq(feedItems.guid, guid))
      .limit(1);
    return rows.length > 0;
  }

  async getBookmarks(): Promise<(Bookmark & { feedItem?: FeedItem })[]> {
    const rows = await db
      .select()
      .from(bookmarks)
      .leftJoin(feedItems, eq(bookmarks.feedItemId, feedItems.id))
      .orderBy(desc(bookmarks.createdAt));

    return rows.map((row) => ({
      ...row.bookmarks,
      feedItem: row.feed_items ?? undefined,
    }));
  }

  async createBookmark(bookmark: InsertBookmark): Promise<Bookmark> {
    const rows = await db.insert(bookmarks).values(bookmark).returning();
    return rows[0];
  }

  async deleteBookmark(feedItemId: number): Promise<void> {
    await db.delete(bookmarks).where(eq(bookmarks.feedItemId, feedItemId));
  }

  async isBookmarked(feedItemId: number): Promise<boolean> {
    const rows = await db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(eq(bookmarks.feedItemId, feedItemId))
      .limit(1);
    return rows.length > 0;
  }

  async getStats(): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    breakingCount: number;
  }> {
    const [totalRow] = await db.select({ value: count() }).from(feedItems);
    const total = totalRow.value;

    const catRows = await db
      .select({ category: feedItems.category, value: count() })
      .from(feedItems)
      .groupBy(feedItems.category);
    const byCategory: Record<string, number> = {};
    for (const r of catRows) byCategory[r.category] = r.value;

    const srcRows = await db
      .select({ source: feedItems.source, value: count() })
      .from(feedItems)
      .groupBy(feedItems.source);
    const bySource: Record<string, number> = {};
    for (const r of srcRows) bySource[r.source] = r.value;

    const [breakingRow] = await db
      .select({ value: count() })
      .from(feedItems)
      .where(eq(feedItems.isBreaking, true));
    const breakingCount = breakingRow.value;

    return { total, byCategory, bySource, breakingCount };
  }

  async getRecentItems(hours: number): Promise<FeedItem[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return await db
      .select()
      .from(feedItems)
      .where(sql`${feedItems.publishedAt} >= ${cutoff}`)
      .orderBy(desc(feedItems.publishedAt));
  }

  async updateClusterId(id: number, clusterId: string): Promise<void> {
    await db.update(feedItems).set({ clusterId }).where(eq(feedItems.id, id));
  }

  async updatePriority(id: number, priority: number): Promise<void> {
    await db.update(feedItems).set({ priority }).where(eq(feedItems.id, id));
  }

  async updateIsBreaking(id: number, isBreaking: boolean): Promise<void> {
    await db.update(feedItems).set({ isBreaking }).where(eq(feedItems.id, id));
  }

  async getItemsByIds(ids: number[]): Promise<FeedItem[]> {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(feedItems)
      .where(inArray(feedItems.id, ids));
  }

  async getBookmarkedIds(feedItemIds: number[]): Promise<Set<number>> {
    if (feedItemIds.length === 0) return new Set();
    const rows = await db
      .select({ feedItemId: bookmarks.feedItemId })
      .from(bookmarks)
      .where(inArray(bookmarks.feedItemId, feedItemIds));
    return new Set(rows.map((r) => r.feedItemId));
  }

  async getSourceActivity(days: number): Promise<Record<string, number[]>> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const totalHours = days * 24;

    const rows = await db.execute(
      sql`SELECT ${feedItems.source} as source,
            date_trunc('hour', ${feedItems.publishedAt}::timestamp) as hour,
            COUNT(*)::int as count
          FROM ${feedItems}
          WHERE ${feedItems.publishedAt} > ${cutoff}
          GROUP BY ${feedItems.source}, hour
          ORDER BY hour`
    );

    // Build a map of source -> hour -> count
    const sourceHourMap: Record<string, Record<string, number>> = {};
    for (const row of rows.rows as any[]) {
      const source = row.source as string;
      const hour = new Date(row.hour as string).toISOString();
      const cnt = Number(row.count);
      if (!sourceHourMap[source]) sourceHourMap[source] = {};
      sourceHourMap[source][hour] = cnt;
    }

    // Generate all hour buckets
    const startHour = new Date(cutoff);
    startHour.setMinutes(0, 0, 0);
    const buckets: string[] = [];
    for (let i = 0; i < totalHours; i++) {
      const h = new Date(startHour.getTime() + i * 60 * 60 * 1000);
      buckets.push(h.toISOString());
    }

    // Pad each source with zeros for missing hours
    const result: Record<string, number[]> = {};
    for (const source of Object.keys(sourceHourMap)) {
      result[source] = buckets.map((b) => sourceHourMap[source][b] || 0);
    }

    return result;
  }

  async getWatchlists(): Promise<Watchlist[]> {
    return await db.select().from(watchlists).orderBy(desc(watchlists.createdAt));
  }

  async createWatchlist(w: InsertWatchlist): Promise<Watchlist> {
    const rows = await db.insert(watchlists).values(w).returning();
    return rows[0];
  }

  async deleteWatchlist(id: number): Promise<void> {
    await db.delete(watchlists).where(eq(watchlists.id, id));
  }

  async getLatestBriefing(): Promise<Briefing | undefined> {
    const rows = await db
      .select()
      .from(briefings)
      .orderBy(desc(briefings.generatedAt))
      .limit(1);
    return rows[0];
  }

  async createBriefing(b: InsertBriefing): Promise<Briefing> {
    const rows = await db.insert(briefings).values(b).returning();
    return rows[0];
  }

  async close(): Promise<void> {
    await pool.end();
  }
}

export const storage = new DatabaseStorage();
