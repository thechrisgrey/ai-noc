CREATE TABLE IF NOT EXISTS "bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_item_id" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "briefings" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"item_count" integer NOT NULL,
	"generated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feed_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"source" text NOT NULL,
	"source_label" text NOT NULL,
	"category" text NOT NULL,
	"published_at" text NOT NULL,
	"fetched_at" text NOT NULL,
	"guid" text NOT NULL,
	"is_breaking" boolean DEFAULT false,
	"image_url" text,
	"cluster_id" text,
	"priority" integer DEFAULT 0,
	CONSTRAINT "feed_items_guid_unique" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"source" text,
	"search" text,
	"sort" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_feed_item_id_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_published_at" ON "feed_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_category_published" ON "feed_items" USING btree ("category","published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_source_published" ON "feed_items" USING btree ("source","published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_is_breaking" ON "feed_items" USING btree ("is_breaking");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cluster_id" ON "feed_items" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_priority" ON "feed_items" USING btree ("priority");