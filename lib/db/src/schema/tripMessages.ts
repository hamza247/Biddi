import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ridesTable } from "./rides";

export const tripMessagesTable = pgTable(
  "trip_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => ridesTable.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["text", "image", "voice"] }).notNull(),
    content: text("content").notNull(),
    audioDurationMs: integer("audio_duration_ms"),
    clientId: text("client_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tripCreatedIdx: index("trip_messages_trip_created_idx").on(
      table.tripId,
      table.createdAt,
    ),
    tripReadIdx: index("trip_messages_trip_read_idx").on(
      table.tripId,
      table.readAt,
    ),
    senderClientIdUnique: uniqueIndex("trip_messages_sender_client_id_unique").on(
      table.tripId,
      table.senderId,
      table.clientId,
    ),
  }),
);

export type TripMessage = typeof tripMessagesTable.$inferSelect;
export type InsertTripMessage = typeof tripMessagesTable.$inferInsert;
