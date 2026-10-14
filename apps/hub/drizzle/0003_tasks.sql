CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"assignee_user_id" text,
	"assignee_agent_id" text,
	"depends_on" text[] DEFAULT '{}'::text[] NOT NULL,
	"paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user" text NOT NULL,
	"created_by_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_team_status_idx" ON "task" USING btree ("team_id","status","updated_at");