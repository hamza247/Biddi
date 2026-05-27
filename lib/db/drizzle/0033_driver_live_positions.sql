CREATE TABLE "driver_live_positions" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"heading" double precision,
	"speed" double precision,
	"accuracy" double precision,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_live_positions" ADD CONSTRAINT "driver_live_positions_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_live_positions_updated_at_idx" ON "driver_live_positions" USING btree ("updated_at");