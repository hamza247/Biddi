CREATE TABLE IF NOT EXISTS "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"title" text NOT NULL,
	"content" jsonb DEFAULT '{"blocks":[]}'::jsonb NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"meta_keywords" text,
	"og_title" text,
	"og_description" text,
	"og_image" text,
	"twitter_card" text DEFAULT 'summary_large_image' NOT NULL,
	"canonical_url" text,
	"robots_index" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_pages_slug_lang_unique" ON "site_pages" ("slug","lang");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"subject" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
