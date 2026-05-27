ALTER TABLE "rides" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
UPDATE "rides" SET "cancelled_by" = 'system' WHERE "status" = 'cancelled' AND "cancelled_by" IS NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_cancelled_by_check" CHECK ("cancelled_by" IS NULL OR "cancelled_by" IN ('rider','driver','system'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rides_accepted_driver_status_cancelled_by_idx" ON "rides" ("accepted_driver_id","status","cancelled_by");
