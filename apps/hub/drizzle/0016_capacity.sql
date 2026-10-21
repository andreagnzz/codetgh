ALTER TABLE "agent" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "usage_five_hour" integer;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "usage_five_hour_reset" timestamp;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "usage_seven_day" integer;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "usage_seven_day_reset" timestamp;