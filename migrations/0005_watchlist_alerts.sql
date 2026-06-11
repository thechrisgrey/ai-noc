ALTER TABLE "briefings" ADD COLUMN "kind" text DEFAULT 'hourly' NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlists" ADD COLUMN "alert" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlists" ADD COLUMN "last_triggered_at" text;