import {
  pgTable,
  uuid,
  integer,
  doublePrecision,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ridesTable } from "./rides";

export const referralLevelsTable = pgTable("referral_levels", {
  level: integer("level").primaryKey(),
  percentage: doublePrecision("percentage").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const referralEarningsTable = pgTable(
  "referral_earnings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    rideId: uuid("ride_id")
      .notNull()
      .references(() => ridesTable.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    percentage: doublePrecision("percentage").notNull(),
    amount: doublePrecision("amount").notNull(),
    status: text("status", { enum: ["credited", "reversed"] })
      .notNull()
      .default("credited"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIdx: index("referral_earnings_user_idx").on(t.userId),
    rideIdx: index("referral_earnings_ride_idx").on(t.rideId),
    rideLevelFromUnique: uniqueIndex(
      "referral_earnings_ride_level_from_unique",
    ).on(t.rideId, t.level, t.fromUserId),
  }),
);

export type ReferralLevel = typeof referralLevelsTable.$inferSelect;
export type InsertReferralLevel = typeof referralLevelsTable.$inferInsert;
export type ReferralEarning = typeof referralEarningsTable.$inferSelect;
export type InsertReferralEarning = typeof referralEarningsTable.$inferInsert;
