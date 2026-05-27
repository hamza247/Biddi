CREATE TABLE "referral_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"ride_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"percentage" double precision NOT NULL,
	"amount" double precision NOT NULL,
	"status" text DEFAULT 'credited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_levels" (
	"level" integer PRIMARY KEY NOT NULL,
	"percentage" double precision NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_earnings_user_idx" ON "referral_earnings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referral_earnings_ride_idx" ON "referral_earnings" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_earnings_ride_level_unique" ON "referral_earnings" USING btree ("ride_id","level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_referred_by_code_idx" ON "users" USING btree ("referred_by_code");
