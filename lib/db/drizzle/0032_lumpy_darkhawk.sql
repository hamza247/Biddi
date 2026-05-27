ALTER TABLE "users" ADD COLUMN "driver_rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "customer_rating" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "customer_rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "customer_rating_score" integer;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "customer_rating_comment" text;