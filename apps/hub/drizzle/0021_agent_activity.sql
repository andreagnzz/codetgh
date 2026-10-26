ALTER TABLE "agent" ADD COLUMN "activity" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "last_tool" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "last_tool_at" timestamp;