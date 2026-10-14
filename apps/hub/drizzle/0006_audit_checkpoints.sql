CREATE TABLE "audit_checkpoint" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"seq" integer NOT NULL,
	"hash" text NOT NULL,
	"prev_checkpoint_seq" integer,
	"at" timestamp (3) NOT NULL,
	"key_id" text NOT NULL,
	"sig" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_checkpoint_team_idx" ON "audit_checkpoint" USING btree ("team_id","seq");