CREATE TABLE "deleted_country_codes" (
	"iso_code" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
