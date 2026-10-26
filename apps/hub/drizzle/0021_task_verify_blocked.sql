ALTER TABLE "task" ADD COLUMN "verify_tag" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
CREATE INDEX "claim_recent_idx" ON "claim" USING btree ("team_id","expires_at");