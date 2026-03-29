import { pgTable, text, serial, integer, boolean, index } from "drizzle-orm/pg-core";
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
  publishedAt: text("published_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  guid: text("guid").notNull().unique(),
  isBreaking: boolean("is_breaking").default(false),
  imageUrl: text("image_url"),
  clusterId: text("cluster_id"),
  priority: integer("priority").default(0),
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

export const insertFeedItemSchema = createInsertSchema(feedItems).omit({ id: true });
export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ id: true });

export type FeedItem = typeof feedItems.$inferSelect;
export type InsertFeedItem = z.infer<typeof insertFeedItemSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
