CREATE TABLE "driver_promotion_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"cycle_start" timestamp with time zone NOT NULL,
	"cycle_end" timestamp with time zone NOT NULL,
	"completed_trips" integer DEFAULT 0 NOT NULL,
	"reward_credited" boolean DEFAULT false NOT NULL,
	"credited_at" timestamp with time zone,
	"near_completion_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_promotion_trip_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"ride_id" uuid NOT NULL,
	"cycle_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"bonus_amount" double precision NOT NULL,
	"required_trips" integer DEFAULT 1 NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"repeat_type" text DEFAULT 'none' NOT NULL,
	"service_area_id" uuid,
	"vehicle_type_id" uuid,
	"driver_scope" text DEFAULT 'all' NOT NULL,
	"eligible_driver_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_promotion_progress" ADD CONSTRAINT "driver_promotion_progress_promotion_id_driver_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."driver_promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_promotion_progress" ADD CONSTRAINT "driver_promotion_progress_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_promotion_trip_logs" ADD CONSTRAINT "driver_promotion_trip_logs_promotion_id_driver_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."driver_promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_promotion_trip_logs" ADD CONSTRAINT "driver_promotion_trip_logs_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_promotion_trip_logs" ADD CONSTRAINT "driver_promotion_trip_logs_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_promotions" ADD CONSTRAINT "driver_promotions_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_promotions" ADD CONSTRAINT "driver_promotions_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_promotions" ADD CONSTRAINT "driver_promotions_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_promotion_progress_uniq" ON "driver_promotion_progress" USING btree ("promotion_id","driver_id","cycle_start");--> statement-breakpoint
CREATE INDEX "driver_promotion_progress_driver_idx" ON "driver_promotion_progress" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_promotion_trip_logs_uniq" ON "driver_promotion_trip_logs" USING btree ("promotion_id","ride_id","cycle_start");--> statement-breakpoint
CREATE INDEX "driver_promotion_trip_logs_driver_cycle_idx" ON "driver_promotion_trip_logs" USING btree ("driver_id","cycle_start");--> statement-breakpoint
CREATE INDEX "driver_promotions_active_idx" ON "driver_promotions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "driver_promotions_window_idx" ON "driver_promotions" USING btree ("start_at","end_at");