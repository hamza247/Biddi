CREATE TABLE IF NOT EXISTS "currencies" (
        "code" varchar(8) PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "symbol" text NOT NULL,
        "rate_from_usd" double precision,
        "last_updated_at" timestamp with time zone,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "currencies" ("code", "name", "symbol", "rate_from_usd", "is_active")
VALUES
        ('USD', 'US Dollar', '$', 1, true),
        ('MAD', 'Moroccan Dirham', 'MAD', NULL, true),
        ('EUR', 'Euro', '€', NULL, true)
ON CONFLICT ("code") DO NOTHING;
