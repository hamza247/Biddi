ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "destination_mode_disabled_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "destination_mode_disabled_reason" text;
