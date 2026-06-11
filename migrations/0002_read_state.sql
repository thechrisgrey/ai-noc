ALTER TABLE "feed_items" ADD COLUMN "read_at" text;--> statement-breakpoint
CREATE INDEX "idx_feed_items_unread" ON "feed_items" ("published_at") WHERE "read_at" IS NULL;
