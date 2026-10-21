CREATE TABLE "run_target" (
	"project_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"desired" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"running" integer DEFAULT 0 NOT NULL,
	"reported_at" timestamp,
	"reported_error" text
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "runner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "base_branch" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "review_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "run_target" ADD CONSTRAINT "run_target_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_target" ADD CONSTRAINT "run_target_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;