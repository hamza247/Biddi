import {
  db,
  referralLevelsTable,
  referralEarningsTable,
  usersTable,
  walletTransactionsTable,
} from "@workspace/db";
import { eq, sql, asc } from "drizzle-orm";
import { logger } from "../lib/logger";

const MAX_LEVELS = 3;
const DEFAULT_LEVELS: Array<{ level: number; percentage: number }> = [
  { level: 1, percentage: 4 },
  { level: 2, percentage: 2 },
  { level: 3, percentage: 1 },
];

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

let cache: { rows: Array<typeof referralLevelsTable.$inferSelect>; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateReferralLevelsCache(): void {
  cache = null;
}

export async function ensureReferralLevelsSeeded(): Promise<void> {
  try {
    const existing = await db.select().from(referralLevelsTable);
    if (existing.length >= MAX_LEVELS) return;
    const present = new Set(existing.map((r) => r.level));
    const missing = DEFAULT_LEVELS.filter((d) => !present.has(d.level));
    if (missing.length === 0) return;
    await db
      .insert(referralLevelsTable)
      .values(missing.map((d) => ({ level: d.level, percentage: d.percentage, isActive: true })))
      .onConflictDoNothing();
    invalidateReferralLevelsCache();
    logger.info({ added: missing.map((m) => m.level) }, "[seed] referral levels seeded");
  } catch (err) {
    logger.error({ err }, "[seed] failed to seed referral levels");
  }
}

export async function getActiveLevels(): Promise<Array<typeof referralLevelsTable.$inferSelect>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const rows = await db
    .select()
    .from(referralLevelsTable)
    .orderBy(asc(referralLevelsTable.level));
  cache = { rows, at: Date.now() };
  return rows;
}

/**
 * Walks the referral chain upward starting from `userId`'s referrer.
 * Returns ancestors in level order [level1, level2, level3]. Stops on
 * cycle, self-reference, or missing ancestor. Capped at maxDepth.
 */
/**
 * Returns true when adopting `candidateReferrerId` as the referrer of
 * `userId` would create a cycle (because `candidateReferrerId` already
 * descends from `userId` somewhere in the existing referral graph).
 *
 * Walks ancestors of the candidate up to a generous depth — referral chains
 * are short by construction, so this stays bounded.
 */
export async function wouldCreateReferralCycle(
  userId: string,
  candidateReferrerId: string,
  maxDepth = 50,
): Promise<boolean> {
  if (userId === candidateReferrerId) return true;
  let current: string | null = candidateReferrerId;
  const visited = new Set<string>();
  for (let i = 0; i < maxDepth; i++) {
    if (!current || visited.has(current)) return false;
    visited.add(current);
    const [row] = await db
      .select({ referredByCode: usersTable.referredByCode })
      .from(usersTable)
      .where(eq(usersTable.id, current))
      .limit(1);
    if (!row?.referredByCode) return false;
    const [parent] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, row.referredByCode))
      .limit(1);
    if (!parent) return false;
    if (parent.id === userId) return true;
    current = parent.id;
  }
  return false;
}

export async function resolveReferralChain(
  userId: string,
  maxDepth = MAX_LEVELS,
): Promise<string[]> {
  const visited = new Set<string>([userId]);
  const ancestors: string[] = [];
  let currentUserId: string | null = userId;

  while (ancestors.length < maxDepth) {
    if (!currentUserId) break;
    const [row] = await db
      .select({
        id: usersTable.id,
        referredByCode: usersTable.referredByCode,
      })
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);
    if (!row || !row.referredByCode) break;
    const [parent] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, row.referredByCode))
      .limit(1);
    if (!parent) break;
    if (visited.has(parent.id)) break;
    visited.add(parent.id);
    ancestors.push(parent.id);
    currentUserId = parent.id;
  }

  return ancestors;
}

export interface DistributeArgs {
  rideId: string;
  payerUserId: string;
  rideAmount: number;
  tx?: Tx;
}

export interface DistributeResult {
  credited: Array<{ userId: string; level: number; amount: number; percentage: number }>;
}

/**
 * Distributes referral rewards up to MAX_LEVELS for a completed ride.
 *
 * - Skips inactive levels (level row missing or isActive=false).
 * - Stops at the first missing ancestor in the chain.
 * - Idempotent via the unique (ride_id, level, from_user_id) constraint on
 *   referral_earnings — so the same ride can credit the rider's upline AND
 *   the driver's upline independently, but never double-credit either.
 * - Credits each ancestor's walletBalance and writes a wallet_transactions row
 *   with source `referral`.
 */
export async function distributeReferralRewards(
  args: DistributeArgs,
): Promise<DistributeResult> {
  const { rideId, payerUserId, rideAmount } = args;
  const exec = args.tx ?? db;
  const result: DistributeResult = { credited: [] };

  if (!Number.isFinite(rideAmount) || rideAmount <= 0) return result;

  const levels = await getActiveLevels();
  const levelByNum = new Map(levels.map((l) => [l.level, l]));
  const ancestors = await resolveReferralChain(payerUserId, MAX_LEVELS);
  if (ancestors.length === 0) return result;

  for (let i = 0; i < ancestors.length; i++) {
    const level = i + 1;
    const lvl = levelByNum.get(level);
    if (!lvl || !lvl.isActive) continue;
    const ancestorId = ancestors[i];
    if (ancestorId === payerUserId) continue;

    const amount = Math.round(rideAmount * (lvl.percentage / 100) * 100) / 100;
    if (amount <= 0) continue;

    try {
      // All three writes must succeed together or none — otherwise the unique
      // (ride_id, level, from_user_id) idempotency guard would lock us out of
      // repairing a half-credited earning. We wrap in a transaction even when called from
      // outside a tx; if a tx is provided we use it directly so the caller
      // owns rollback semantics for the whole ride.
      const credited = await ((exec as typeof db).transaction
        ? (exec as typeof db).transaction(async (txn) =>
            creditOneLevel(txn, {
              ancestorId,
              payerUserId,
              rideId,
              level,
              amount,
              percentage: lvl.percentage,
            }),
          )
        : creditOneLevel(exec, {
            ancestorId,
            payerUserId,
            rideId,
            level,
            amount,
            percentage: lvl.percentage,
          }));

      if (credited) {
        result.credited.push({ userId: ancestorId, level, amount, percentage: lvl.percentage });
      }
    } catch (err) {
      // Any failure here means the transaction rolled back, so no earning
      // row was committed — a future call for the same ride can retry safely.
      logger.error(
        { err, rideId, ancestorId, level },
        "[referrals] unexpected error distributing reward",
      );
    }
  }

  return result;
}

async function creditOneLevel(
  exec: Tx,
  args: {
    ancestorId: string;
    payerUserId: string;
    rideId: string;
    level: number;
    amount: number;
    percentage: number;
  },
): Promise<boolean> {
  const inserted = await exec
    .insert(referralEarningsTable)
    .values({
      userId: args.ancestorId,
      fromUserId: args.payerUserId,
      rideId: args.rideId,
      level: args.level,
      percentage: args.percentage,
      amount: args.amount,
      status: "credited",
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) return false;

  await exec.insert(walletTransactionsTable).values({
    driverId: args.ancestorId,
    type: "referral",
    amount: args.amount,
    rideId: args.rideId,
    note: `Referral reward L${args.level} (${args.percentage}%)`,
  });

  await exec
    .update(usersTable)
    .set({
      walletBalance: sql`(${usersTable.walletBalance}::numeric + ${args.amount})::text`,
    })
    .where(eq(usersTable.id, args.ancestorId));

  return true;
}
