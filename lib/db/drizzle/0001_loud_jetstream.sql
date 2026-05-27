UPDATE "vehicle_types"
SET "class_key" = NULL
WHERE "class_key" IS NOT NULL
  AND "class_key" NOT IN (SELECT "slug" FROM "app_classes");
--> statement-breakpoint
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_class_key_app_classes_slug_fk" FOREIGN KEY ("class_key") REFERENCES "public"."app_classes"("slug") ON DELETE set null ON UPDATE no action;
