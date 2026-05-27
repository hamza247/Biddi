CREATE TABLE "notification_sounds" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "slug" text NOT NULL,
        "display_name" text NOT NULL,
        "mime_type" text NOT NULL,
        "size_bytes" integer NOT NULL,
        "object_path" text NOT NULL,
        "checksum" text NOT NULL,
        "created_by_admin_id" uuid,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "notification_sounds_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "notification_sounds_slug_idx" ON "notification_sounds" USING btree ("slug");--> statement-breakpoint
CREATE TABLE "notification_sounds_build" (
        "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
        "manifest_hash" text NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
