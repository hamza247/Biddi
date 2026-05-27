import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  doublePrecision,
  integer,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: text("phone").notNull().unique(),
  countryCode: text("country_code").notNull().default("+1"),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  email: text("email").unique(),
  referralCode: text("referral_code").unique(),
  referredByCode: text("referred_by_code"),
  gender: text("gender"),
  country: text("country"),
  city: text("city"),
  photoUrl: text("photo_url"),
  walletBalance: text("wallet_balance").notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  password: text("password"),
  appMode: text("app_mode", { enum: ["rider", "driver"] })
    .notNull()
    .default("rider"),
  driverStatus: text("driver_status", {
    enum: ["not_applied", "pending", "approved", "rejected", "suspended"],
  })
    .notNull()
    .default("not_applied"),
  driverOnline: boolean("driver_online").notNull().default(false),
  submittedDocs: jsonb("submitted_docs").$type<Array<string | { type: string; url: string; contentType?: string; status?: "pending" | "approved" | "rejected"; rejectionReason?: string }>>().notNull().default([]),
  rating: text("rating").notNull().default("4.92"),
  driverRatingCount: integer("driver_rating_count").notNull().default(0),
  trips: text("trips").notNull().default("0"),
  customerRating: text("customer_rating"),
  customerRatingCount: integer("customer_rating_count").notNull().default(0),
  driverRejectionReason: text("driver_rejection_reason"),
  driverSuspensionReason: text("driver_suspension_reason"),
  destinationModeDisabledUntil: timestamp("destination_mode_disabled_until", {
    withTimezone: true,
  }),
  destinationModeDisabledReason: text("destination_mode_disabled_reason"),
  expoPushToken: text("expo_push_token"),
  quickReplies: jsonb("quick_replies")
    .$type<{ driver?: string[]; rider?: string[] }>()
    .notNull()
    .default({}),
  lastKnownLat: doublePrecision("last_known_lat"),
  lastKnownLng: doublePrecision("last_known_lng"),
  lastKnownHeading: doublePrecision("last_known_heading"),
  lastKnownAt: timestamp("last_known_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeConnectAccountId: text("stripe_connect_account_id").unique(),
  stripeConnectChargesEnabled: boolean("stripe_connect_charges_enabled")
    .notNull()
    .default(false),
  stripeConnectPayoutsEnabled: boolean("stripe_connect_payouts_enabled")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
