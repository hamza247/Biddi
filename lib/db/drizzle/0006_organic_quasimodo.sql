CREATE TABLE "safety_alerts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "ride_id" uuid NOT NULL,
        "triggered_by_id" uuid NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "resolved_by_id" uuid,
        "resolved_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_resolved_by_id_admins_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;
