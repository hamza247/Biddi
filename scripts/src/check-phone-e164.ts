/**
 * check-phone-e164.ts
 *
 * One-time audit script: queries every row in the `users` table and verifies
 * that the stored `phone` value is a valid E.164 string (starts with "+" and
 * contains 7–15 digits total).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run check-phone-e164
 *
 * Exit codes:
 *   0 – all phones are valid E.164
 *   1 – one or more phones are malformed (details printed to stdout)
 */

import { db, usersTable } from "@workspace/db";

const E164_RE = /^\+\d{7,15}$/;

async function main() {
  console.log("Checking phone numbers in the `users` table for E.164 format…");

  const rows = await db
    .select({ id: usersTable.id, phone: usersTable.phone })
    .from(usersTable);

  const violations = rows.filter((r) => !E164_RE.test(r.phone));

  if (violations.length === 0) {
    console.log(`✓ All ${rows.length} phone(s) are valid E.164.`);
    process.exit(0);
  }

  console.error(
    `✗ Found ${violations.length} phone(s) that are NOT valid E.164 (out of ${rows.length} total):\n`,
  );
  for (const v of violations) {
    console.error(`  user id=${v.id}  phone=${JSON.stringify(v.phone)}`);
  }
  console.error(
    "\nTo fix, run the UPDATE below for each row, replacing <id> and <corrected_phone>:",
  );
  console.error(
    "  UPDATE users SET phone = '<corrected_phone>' WHERE id = '<id>';",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(2);
});
