CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "feed_items" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
CREATE INDEX "idx_feed_items_embedding" ON "feed_items" USING hnsw ("embedding" vector_cosine_ops);