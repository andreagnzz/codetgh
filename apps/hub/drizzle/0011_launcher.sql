CREATE TABLE "launch_target" (
	"project_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"desired" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"running" boolean DEFAULT false NOT NULL,
	"reported_at" timestamp,
	"reported_error" text
);
--> statement-breakpoint
ALTER TABLE "launch_target" ADD CONSTRAINT "launch_target_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_target" ADD CONSTRAINT "launch_target_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;