DELETE FROM "personal_token";--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_id" text,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"branch" text,
	"project_id" text,
	"trust_level" text DEFAULT 'trusted' NOT NULL,
	"status_text" text,
	"status_paths" text[],
	"status_expires_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"message_id" text,
	"thread_id" text,
	"agent_id" text,
	"user_id" text,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excerpt" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_agent_id" text,
	"via" text NOT NULL,
	"action" text NOT NULL,
	"subject_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp (3) NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"accepted_user_id" text,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"from_agent_id" text,
	"authored_by" text NOT NULL,
	"kind" text NOT NULL,
	"priority" text NOT NULL,
	"to" jsonb NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" text,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"hop" integer DEFAULT 0 NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"idempotency_key" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"repo_fingerprint" text NOT NULL,
	"default_branch" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"team_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"recipient_agent_id" text,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"ack_status" text,
	"ack_note" text
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kill_switch_at" timestamp,
	"kill_switch_reason" text,
	"kill_switch_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"project_id" text,
	"subject" text,
	"created_by_user" text NOT NULL,
	"agent_streak" integer DEFAULT 0 NOT NULL,
	"muted_at" timestamp,
	"muted_reason" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_token" ADD COLUMN "team_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_token" ADD COLUMN "kind" text DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_token" ADD COLUMN "last_used_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_uq" ON "agent" USING btree ("team_id","user_id","session_id");--> statement-breakpoint
CREATE INDEX "agent_team_seen_idx" ON "agent" USING btree ("team_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "alert_team_status_idx" ON "alert" USING btree ("team_id","status","created_at");--> statement-breakpoint
CREATE INDEX "audit_team_seq_idx" ON "audit_event" USING btree ("team_id","seq");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_team_user_uq" ON "membership" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_team_handle_uq" ON "membership" USING btree ("team_id","handle");--> statement-breakpoint
CREATE INDEX "message_thread_idx" ON "message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "message_agent_idx" ON "message" USING btree ("from_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "message_reply_idx" ON "message" USING btree ("reply_to");--> statement-breakpoint
CREATE UNIQUE INDEX "message_idempotency_uq" ON "message" USING btree ("from_agent_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_team_fingerprint_uq" ON "project" USING btree ("team_id","repo_fingerprint");--> statement-breakpoint
CREATE INDEX "receipt_recipient_idx" ON "receipt" USING btree ("recipient_user_id","read_at","seq");--> statement-breakpoint
CREATE INDEX "thread_team_last_idx" ON "thread" USING btree ("team_id","last_message_at");--> statement-breakpoint
ALTER TABLE "personal_token" ADD CONSTRAINT "personal_token_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;