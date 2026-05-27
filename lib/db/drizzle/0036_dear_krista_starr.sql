ALTER TABLE "rides" ADD COLUMN "bidding_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "expires_at" timestamp with time zone;