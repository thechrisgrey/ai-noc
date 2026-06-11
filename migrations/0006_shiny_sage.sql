ALTER TABLE "briefings" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "sent_at" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "surfaced_cluster_ids" text;