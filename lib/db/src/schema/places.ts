import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const placesTable = pgTable(
  "places",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["saved", "recent"] }).notNull(),
    label: text("label").notNull().default(""),
    address: text("address").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    googlePlaceId: text("google_place_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userKindIdx: index("places_user_kind_idx").on(t.userId, t.kind),
  }),
);

export type Place = typeof placesTable.$inferSelect;
export type InsertPlace = typeof placesTable.$inferInsert;
