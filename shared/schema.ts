import { pgTable, text, serial, integer, boolean, index, vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Feed items from various sources
export const feedItems = pgTable("feed_items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url"),
  source: text("source").notNull(),
  sourceLabel: text("source_label").notNull(),
  category: text("category").notNull(),
  // Canonical UTC ISO-8601 with Z suffix (Date.prototype.toISOString) so that
  // lexicographic order equals chronological order; cursor pagination and
  // priority decay compare this column as text. Every write path must
  // normalize through toISOString().
  publishedAt: text("published_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  guid: text("guid").notNull().unique(),
  // Ingest-time heuristic only until the first recompute; after that,
  // recomputePriorities owns this flag (threshold in shared/constants.ts).
  isBreaking: boolean("is_breaking").default(false),
  imageUrl: text("image_url"),
  clusterId: text("cluster_id"),
  priority: integer("priority").notNull().default(0),
  readAt: text("read_at"),
  // Titan v2 embedding (1024-d, cosine-normalized). NULL until the ingest
  // sweep embeds the item; backfill self-heals transient failures.
  embedding: vector("embedding", { dimensions: 1024 }),
}, (table) => [
  index("idx_published_at").on(table.publishedAt),
  index("idx_category_published").on(table.category, table.publishedAt),
  index("idx_source_published").on(table.source, table.publishedAt),
  index("idx_is_breaking").on(table.isBreaking),
  index("idx_cluster_id").on(table.clusterId),
  index("idx_priority").on(table.priority),
]);

export const bookmarks = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  feedItemId: integer("feed_item_id").notNull().references(() => feedItems.id),
  createdAt: text("created_at").notNull(),
});

export const watchlists = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  source: text("source"),
  search: text("search"),
  sort: text("sort"),
  // When true, new ingested items matching this watchlist push a real-time
  // alert; lastTriggeredAt stamps the most recent hit (canonical UTC ISO).
  alert: boolean("alert").notNull().default(false),
  lastTriggeredAt: text("last_triggered_at"),
  createdAt: text("created_at").notNull(),
});

export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  itemCount: integer("item_count").notNull(),
  generatedAt: text("generated_at").notNull(),
  // 'hourly' (legacy executive briefing), 'daily_digest' (legacy roundup), or
  // the two-tier brief kinds 'daily_skim' / 'weekly_heavy'. The archive UI
  // filters on this.
  kind: text("kind").notNull().default("hourly"),
  // Approval lifecycle for the two-tier brief: 'draft' (generated, awaiting the
  // owner's review) -> 'approved' -> 'sent'. Legacy/auto briefings default to
  // 'sent' so they never surface as a pending draft.
  status: text("status").notNull().default("sent"),
  // Email subject / headline derived from the lede; editable in the workshop
  // before send. NULL for legacy briefings (sender falls back to a default).
  subject: text("subject"),
  // Canonical UTC ISO stamp set when the approved brief is delivered.
  sentAt: text("sent_at"),
  // JSON array of cluster ids surfaced in this brief (CORE + periphery), used to
  // dedupe the periphery valve against recent briefs. NULL for legacy rows.
  surfacedClusterIds: text("surfaced_cluster_ids"),
});

// RSS/Atom feed sources. slug doubles as feed_items.source; deleting a source
// intentionally orphans its items (they keep the slug).
export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  url: text("url").notNull().unique(),
  defaultCategory: text("default_category").notNull(),
  // Domain section ('ai' | 'csp' | 'quantum'); see SECTIONS in shared/constants.
  section: text("section").notNull().default("ai"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const insertFeedItemSchema = createInsertSchema(feedItems).omit({ id: true });
export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ id: true });
export const insertWatchlistSchema = createInsertSchema(watchlists).omit({ id: true });
export const insertBriefingSchema = createInsertSchema(briefings).omit({ id: true });
export const insertSourceSchema = createInsertSchema(sources).omit({ id: true });

export type FeedItem = typeof feedItems.$inferSelect;
export type InsertFeedItem = z.infer<typeof insertFeedItemSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Watchlist = typeof watchlists.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type Briefing = typeof briefings.$inferSelect;
export type InsertBriefing = z.infer<typeof insertBriefingSchema>;
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;
