CREATE TABLE "memory_item" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"number" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"branch" text,
	"supersedes_id" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"proposed_by_user" text NOT NULL,
	"proposed_by_agent" text,
	"authored_by" text NOT NULL,
	"decided_by_user" text,
	"decided_via" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_number_version_uq" ON "memory_item" USING btree ("team_id","number","version");--> statement-breakpoint
CREATE INDEX "memory_team_status_idx" ON "memory_item" USING btree ("team_id","status");