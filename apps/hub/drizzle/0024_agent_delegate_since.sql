ALTER TABLE "agent" ADD COLUMN "delegate_since" timestamp;--> statement-breakpoint
UPDATE "agent" SET "delegate_since" = now() WHERE "accept_requests_from" IS NOT NULL;