import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

export const appBannersTable = pgTable("app_banners", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  imageUrl: text("image_url"),
  placement: text("placement", {
    enum: ["rider_home", "driver_home", "onboarding"],
  })
    .notNull()
    .default("rider_home"),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppBanner = typeof appBannersTable.$inferSelect;
export type InsertAppBanner = typeof appBannersTable.$inferInsert;

export const cancellationReasonsTable = pgTable("cancellation_reasons", {
  id: uuid("id").defaultRandom().primaryKey(),
  text: text("text").notNull(),
  appliesTo: text("applies_to", { enum: ["rider", "driver", "both"] })
    .notNull()
    .default("both"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CancellationReason = typeof cancellationReasonsTable.$inferSelect;
export type InsertCancellationReason = typeof cancellationReasonsTable.$inferInsert;

export const notificationTemplatesTable = pgTable("notification_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type", { enum: ["sms", "email", "push"] }).notNull().default("push"),
  key: text("key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NotificationTemplate = typeof notificationTemplatesTable.$inferSelect;
export type InsertNotificationTemplate = typeof notificationTemplatesTable.$inferInsert;

export const rewardLevelsTable = pgTable("reward_levels", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  minimumTrips: integer("minimum_trips").notNull().default(0),
  minimumRating: doublePrecision("minimum_rating").notNull().default(4.0),
  maxCancellationRate: doublePrecision("max_cancellation_rate").notNull().default(20),
  minAcceptanceRate: doublePrecision("min_acceptance_rate").notNull().default(80),
  rewardAmount: doublePrecision("reward_amount").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RewardLevel = typeof rewardLevelsTable.$inferSelect;
export type InsertRewardLevel = typeof rewardLevelsTable.$inferInsert;
