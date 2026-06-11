UPDATE "feed_items" SET "priority" = 0 WHERE "priority" IS NULL;--> statement-breakpoint
ALTER TABLE "feed_items" ALTER COLUMN "priority" SET NOT NULL;
