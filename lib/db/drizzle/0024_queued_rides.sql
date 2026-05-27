CREATE TABLE IF NOT EXISTS "driver_queued_rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"current_trip_id" uuid NOT NULL,
	"next_trip_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pickup_lat" double precision,
	"pickup_lng" double precision,
	"dropoff_lat" double precision,
	"dropoff_lng" double precision,
	"estimated_pickup_after_minutes" integer,
	"queue_position" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_queued_rides" ADD CONSTRAINT "driver_queued_rides_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_queued_rides" ADD CONSTRAINT "driver_queued_rides_current_trip_id_rides_id_fk" FOREIGN KEY ("current_trip_id") REFERENCES "rides"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_queued_rides" ADD CONSTRAINT "driver_queued_rides_next_trip_id_rides_id_fk" FOREIGN KEY ("next_trip_id") REFERENCES "rides"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_queued_rides_driver_status_idx" ON "driver_queued_rides" ("driver_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_queued_rides_next_trip_idx" ON "driver_queued_rides" ("next_trip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_queued_rides_current_trip_idx" ON "driver_queued_rides" ("current_trip_id");--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "queued_driver_id" uuid;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "queue_status" text;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "previous_trip_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rides" ADD CONSTRAINT "rides_queued_driver_id_users_id_fk" FOREIGN KEY ("queued_driver_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rides" ADD CONSTRAINT "rides_previous_trip_id_rides_id_fk" FOREIGN KEY ("previous_trip_id") REFERENCES "rides"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
