CREATE TABLE "driver_trail_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"ride_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"heading" double precision,
	"speed" double precision,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_trail_points" ADD CONSTRAINT "driver_trail_points_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_trail_points_driver_ride_idx" ON "driver_trail_points" USING btree ("driver_id","ride_id");--> statement-breakpoint
CREATE INDEX "driver_trail_points_recorded_at_idx" ON "driver_trail_points" USING btree ("recorded_at");