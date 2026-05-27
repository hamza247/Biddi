ALTER TABLE "currencies" ADD COLUMN "decimal_places" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "symbol_position" text DEFAULT 'before' NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "thousands_separator" text DEFAULT 'comma' NOT NULL;--> statement-breakpoint
ALTER TABLE "currencies" ADD COLUMN "decimal_separator" text DEFAULT 'dot' NOT NULL;