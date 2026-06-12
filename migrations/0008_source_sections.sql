ALTER TABLE "sources" ADD COLUMN "section" text DEFAULT 'ai' NOT NULL;
--> statement-breakpoint
UPDATE "sources" SET "section" = 'csp' WHERE "slug" IN
	('aws_ml','aws_whats_new','amazon_science','gcp_ai','deepmind',
	 'google_research','google_devs','vertex_genai','nvidia_dev',
	 'nvidia_genai','ibm_research');
--> statement-breakpoint
UPDATE "sources" SET "section" = 'quantum' WHERE "slug" IN
	('ionq','quera','pasqal','rigetti','quantum_insider');
