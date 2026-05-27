CREATE TABLE IF NOT EXISTS "driver_destination_modes" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"driver_id" uuid NOT NULL,
"destination_label" text DEFAULT '' NOT NULL,
"destination_address" text NOT NULL,
"dest_lat" double precision NOT NULL,
"dest_lng" double precision NOT NULL,
"is_active" boolean DEFAULT true NOT NULL,
"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
"expires_at" timestamp with time zone,
"completed_trip_id" uuid,
"deactivated_at" timestamp with time zone,
"deactivated_reason" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_destination_modes" ADD CONSTRAINT "driver_destination_modes_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_destination_modes" ADD CONSTRAINT "driver_destination_modes_completed_trip_id_rides_id_fk" FOREIGN KEY ("completed_trip_id") REFERENCES "rides"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_destination_modes_driver_active_idx" ON "driver_destination_modes" ("driver_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_destination_modes_driver_created_idx" ON "driver_destination_modes" ("driver_id","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_saved_places" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"driver_id" uuid NOT NULL,
"kind" text NOT NULL,
"label" text DEFAULT '' NOT NULL,
"address" text NOT NULL,
"lat" double precision NOT NULL,
"lng" double precision NOT NULL,
"google_place_id" text,
"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_saved_places" ADD CONSTRAINT "driver_saved_places_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_saved_places_driver_kind_idx" ON "driver_saved_places" ("driver_id","kind");
