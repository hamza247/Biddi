import {
  pgTable,
  uuid,
  timestamp,
  doublePrecision,
  integer,
  text,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ridesTable } from "./rides";

export const bidsTable = pgTable("bids", {
  id: uuid("id").defaultRandom().primaryKey(),
  rideId: uuid("ride_id")
    .notNull()
    .references(() => ridesTable.id, { onDelete: "cascade" }),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  amount: doublePrecision("amount").notNull(),
  etaMin: integer("eta_min").notNull(),
  status: text("status", {
    enum: ["active", "accepted", "rejected", "cancelled", "expired"],
  })
    .notNull()
    .default("active"),
  // Optional message from the driver shown alongside their bid
  // (e.g. "I'm 2 min away"). NULL when the driver didn't include one.
  note: text("note"),
  // Deadline after which the bid auto-expires if not accepted. Set on insert
  // to now()+90s by the bidding route; the expiry job flips status to
  // 'expired' once exceeded.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Bid = typeof bidsTable.$inferSelect;
export type InsertBid = typeof bidsTable.$inferInsert;
