CREATE TABLE "airport_surcharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airport_location_id" uuid NOT NULL,
	"vehicle_type_id" uuid NOT NULL,
	"surcharge_type" text DEFAULT 'multiplier' NOT NULL,
	"pickup_surcharge_value" double precision DEFAULT 1 NOT NULL,
	"dropoff_surcharge_value" double precision DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "center_lat" double precision;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "center_lng" double precision;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "radius_m" integer;--> statement-breakpoint
ALTER TABLE "airport_surcharges" ADD CONSTRAINT "airport_surcharges_airport_location_id_service_areas_id_fk" FOREIGN KEY ("airport_location_id") REFERENCES "public"."service_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airport_surcharges" ADD CONSTRAINT "airport_surcharges_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "airport_surcharges_airport_vehicle_uniq" ON "airport_surcharges" USING btree ("airport_location_id","vehicle_type_id");
