import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const appClassesTable = pgTable("app_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  colorHex: text("color_hex"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppClass = typeof appClassesTable.$inferSelect;
export type InsertAppClass = typeof appClassesTable.$inferInsert;
