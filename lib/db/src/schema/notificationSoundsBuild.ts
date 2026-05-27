import { pgTable, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export type BundledSoundEntry = { slug: string; checksum: string };

/**
 * Single-row table tracking which manifest hash the most recent EAS mobile
 * build was produced from. The mobile build sync script POSTs the new hash
 * after writing files into the Expo project so the admin UI can show a
 * per-sound "in current mobile build" indicator.
 */
export const notificationSoundsBuildTable = pgTable("notification_sounds_build", {
  id: integer("id").primaryKey().default(1),
  manifestHash: text("manifest_hash").notNull(),
  bundledSounds: jsonb("bundled_sounds").$type<BundledSoundEntry[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type NotificationSoundsBuild = typeof notificationSoundsBuildTable.$inferSelect;
