CREATE TABLE "claim" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"holder_user_id" text NOT NULL,
	"holder_agent_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope" text NOT NULL,
	"mode" text NOT NULL,
	"reason" text,
	"ttl_s" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"released_at" timestamp,
	"released_by" text,
	"release_reason" text,
	"notified_agents" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_active_project_idx" ON "claim" USING btree ("team_id","project_id","expires_at") WHERE "claim"."released_at" is null;--> statement-breakpoint
CREATE INDEX "claim_holder_idx" ON "claim" USING btree ("holder_agent_id") WHERE "claim"."released_at" is null;