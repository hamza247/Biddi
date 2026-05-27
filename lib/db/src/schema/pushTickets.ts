import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const pushTicketsTable = pgTable(
  "push_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    receiptId: text("receipt_id").notNull().unique(),
    rideId: uuid("ride_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("push_tickets_created_at_idx").on(table.createdAt)],
);

export type PushTicket = typeof pushTicketsTable.$inferSelect;
export type InsertPushTicket = typeof pushTicketsTable.$inferInsert;
