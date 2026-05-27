ALTER TABLE "users" ADD COLUMN "last_known_lat" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_known_lng" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_known_heading" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_known_at" timestamp with time zone;
