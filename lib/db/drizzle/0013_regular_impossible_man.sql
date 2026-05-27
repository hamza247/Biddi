CREATE TABLE "payout_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"method" text NOT NULL,
	"account_name" text NOT NULL,
	"bank_name" text,
	"account_number" text,
	"iban" text,
	"mobile_provider" text,
	"mobile_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"amount" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payout_method_snapshot" jsonb NOT NULL,
	"payment_reference" text,
	"rejection_reason" text,
	"decided_by_admin_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weather_readings_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"rain_mm" double precision DEFAULT 0 NOT NULL,
	"snow_mm" double precision DEFAULT 0 NOT NULL,
	"temp_c" double precision DEFAULT 0 NOT NULL,
	"wind_ms" double precision DEFAULT 0 NOT NULL,
	"weather_main" text,
	"weather_description" text,
	"observed_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_surcharge_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"country_iso" text,
	"service_area_id" uuid,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kind" text DEFAULT 'multiplier' NOT NULL,
	"value" double precision DEFAULT 1 NOT NULL,
	"start_time" text,
	"end_time" text,
	"days_of_week" integer[],
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN "withdrawal_request_id" uuid;--> statement-breakpoint
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_decided_by_admin_id_admins_id_fk" FOREIGN KEY ("decided_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_methods_driver_id_idx" ON "payout_methods" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_driver_status_idx" ON "withdrawal_requests" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests" USING btree ("status");