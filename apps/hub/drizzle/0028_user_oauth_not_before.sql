ALTER TABLE "user" ADD COLUMN "oauth_not_before" timestamp;--> statement-breakpoint
ALTER TABLE "membership" DROP COLUMN "oauth_not_before";