CREATE TABLE "bridge_link" (
	"slack_channel" text NOT NULL,
	"slack_ts" text NOT NULL,
	"team_id" text NOT NULL,
	"message_id" text,
	"alert_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_link_slack_channel_slack_ts_pk" PRIMARY KEY("slack_channel","slack_ts")
);
--> statement-breakpoint
CREATE TABLE "slack_link" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slack_user_id" text,
	"code_hash" text,
	"code_expires_at" timestamp,
	CONSTRAINT "slack_link_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "bridge_link" ADD CONSTRAINT "bridge_link_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_link" ADD CONSTRAINT "slack_link_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_link" ADD CONSTRAINT "slack_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_link_alert_idx" ON "bridge_link" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_link_slack_user_uq" ON "slack_link" USING btree ("team_id","slack_user_id");