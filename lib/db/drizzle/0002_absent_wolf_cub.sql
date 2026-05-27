CREATE TYPE "public"."dispatch_method" AS ENUM('socket', 'push');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('queued', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "ride_dispatch_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"method" "dispatch_method" NOT NULL,
	"status" "dispatch_status" DEFAULT 'queued' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tickets" ADD COLUMN "ride_id" uuid;--> statement-breakpoint
CREATE INDEX "ride_dispatch_logs_ride_id_idx" ON "ride_dispatch_logs" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "ride_dispatch_logs_driver_id_idx" ON "ride_dispatch_logs" USING btree ("driver_id");
