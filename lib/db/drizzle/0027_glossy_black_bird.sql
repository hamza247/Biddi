ALTER TABLE "trip_messages" ADD COLUMN "audio_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "trip_messages_trip_created_idx" ON "trip_messages" USING btree ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_messages_trip_read_idx" ON "trip_messages" USING btree ("trip_id","read_at");