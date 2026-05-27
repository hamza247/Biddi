CREATE TABLE "coupon_redemptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "coupon_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "ride_id" uuid NOT NULL,
        "discount_amount" double precision NOT NULL,
        "redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "code" text NOT NULL,
        "description" text,
        "discount_type" text NOT NULL,
        "discount_value" double precision NOT NULL,
        "max_discount" double precision,
        "min_trip_amount" double precision,
        "usage_limit_total" integer,
        "usage_limit_per_user" integer,
        "total_used" integer DEFAULT 0 NOT NULL,
        "valid_from" timestamp with time zone,
        "valid_until" timestamp with time zone,
        "first_ride_only" boolean DEFAULT false NOT NULL,
        "country_codes" text[],
        "vehicle_type_ids" uuid[],
        "active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "coupon_discount" double precision;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_ride_unique" ON "coupon_redemptions" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_user_idx" ON "coupon_redemptions" USING btree ("coupon_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_lower_unique" ON "coupons" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "coupons_active_idx" ON "coupons" USING btree ("active");