import { index, pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";

export const notificationSoundsTable = pgTable(
  "notification_sounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    objectPath: text("object_path").notNull(),
    checksum: text("checksum").notNull(),
    createdByAdminId: uuid("created_by_admin_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("notification_sounds_slug_idx").on(table.slug)],
);

export type NotificationSound = typeof notificationSoundsTable.$inferSelect;
export type InsertNotificationSound = typeof notificationSoundsTable.$inferInsert;
