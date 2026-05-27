import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

export const adminsTable = pgTable("admins", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default("Admin"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Admin = typeof adminsTable.$inferSelect;
