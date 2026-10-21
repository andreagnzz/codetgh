ALTER TABLE "agent" ADD COLUMN "accept_requests_from" text[];--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "delegated" boolean DEFAULT false NOT NULL;