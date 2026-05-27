import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  referralLevelsTable,
  referralEarningsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, lte, or, ilike, sql } from "drizzle-orm";
import { requireAdmin, requireUser } from "../middlewares/auth";
import { invalidateReferralLevelsCache } from "../services/referrals";
import { extractBearer, verifyToken } from "../lib/auth";
import { adminsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/admin/referral-levels", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(referralLevelsTable)
    .orderBy(asc(referralLevelsTable.level));
  res.json({ levels: rows });
});

router.put("/admin/referral-levels/:level", requireAdmin, async (req, res): Promise<void> => {
  const levelNum = Number((req.params.level as string));
  if (!Number.isInteger(levelNum) || levelNum < 1 || levelNum > 3) {
    res.status(400).json({ error: "invalid_level" });
    return;
  }
  const parsed = z
    .object({
      percentage: z.number().min(0).max(100),
      isActive: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const [existing] = await db
    .select()
    .from(referralLevelsTable)
    .where(eq(referralLevelsTable.level, levelNum))
    .limit(1);

  let row;
  if (!existing) {
    [row] = await db
      .insert(referralLevelsTable)
      .values({
        level: levelNum,
        percentage: parsed.data.percentage,
        isActive: parsed.data.isActive ?? true,
      })
      .returning();
  } else {
    [row] = await db
      .update(referralLevelsTable)
      .set({
        percentage: parsed.data.percentage,
        ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(referralLevelsTable.level, levelNum))
      .returning();
  }
  invalidateReferralLevelsCache();
  res.json({ level: row });
});

const earningsFiltersSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  level: z.coerce.number().int().min(1).max(3).optional(),
  userId: z.string().uuid().optional(),
  rideId: z.string().uuid().optional(),
});

function buildEarningsWhere(filters: z.infer<typeof earningsFiltersSchema>) {
  const conds = [] as ReturnType<typeof eq>[];
  if (filters.from) conds.push(gte(referralEarningsTable.createdAt, new Date(filters.from)));
  if (filters.to) conds.push(lte(referralEarningsTable.createdAt, new Date(filters.to)));
  if (filters.level !== undefined) conds.push(eq(referralEarningsTable.level, filters.level));
  if (filters.userId) conds.push(eq(referralEarningsTable.userId, filters.userId));
  if (filters.rideId) conds.push(eq(referralEarningsTable.rideId, filters.rideId));
  return conds.length > 0 ? and(...conds) : undefined;
}

router.get("/admin/referral-earnings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = earningsFiltersSchema
    .extend({
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const { limit, offset, ...filters } = parsed.data;
  const where = buildEarningsWhere(filters);

  const rows = await db
    .select({
      id: referralEarningsTable.id,
      userId: referralEarningsTable.userId,
      fromUserId: referralEarningsTable.fromUserId,
      rideId: referralEarningsTable.rideId,
      level: referralEarningsTable.level,
      percentage: referralEarningsTable.percentage,
      amount: referralEarningsTable.amount,
      status: referralEarningsTable.status,
      createdAt: referralEarningsTable.createdAt,
      beneficiaryName: sql<string>`bu.first_name || ' ' || coalesce(bu.last_name, '')`,
      beneficiaryPhone: sql<string>`bu.phone`,
      fromUserName: sql<string>`fu.first_name || ' ' || coalesce(fu.last_name, '')`,
      fromUserPhone: sql<string>`fu.phone`,
    })
    .from(referralEarningsTable)
    .leftJoin(sql`${usersTable} as bu`, sql`bu.id = ${referralEarningsTable.userId}`)
    .leftJoin(sql`${usersTable} as fu`, sql`fu.id = ${referralEarningsTable.fromUserId}`)
    .where(where)
    .orderBy(desc(referralEarningsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total, totalAmount }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${referralEarningsTable.amount}), 0)::float`,
    })
    .from(referralEarningsTable)
    .where(where);

  res.json({ earnings: rows, total, totalAmount });
});

router.get("/admin/referral-earnings/summary", requireAdmin, async (req, res): Promise<void> => {
  const parsed = earningsFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const where = buildEarningsWhere(parsed.data);

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${referralEarningsTable.amount}), 0)::float`,
      uniqueBeneficiaries: sql<number>`count(distinct ${referralEarningsTable.userId})::int`,
      uniqueRides: sql<number>`count(distinct ${referralEarningsTable.rideId})::int`,
    })
    .from(referralEarningsTable)
    .where(where);

  const byLevel = await db
    .select({
      level: referralEarningsTable.level,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${referralEarningsTable.amount}), 0)::float`,
    })
    .from(referralEarningsTable)
    .where(where)
    .groupBy(referralEarningsTable.level)
    .orderBy(asc(referralEarningsTable.level));

  res.json({ ...totals, byLevel });
});

const meHandler = async (req: import("express").Request, res: import("express").Response) => {
  const userId = (req as { userId?: string }).userId!;

  const [user] = await db
    .select({ referralCode: usersTable.referralCode })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const [totals] = await db
    .select({
      total: sql<number>`coalesce(sum(${referralEarningsTable.amount}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(referralEarningsTable)
    .where(eq(referralEarningsTable.userId, userId));

  const byLevel = await db
    .select({
      level: referralEarningsTable.level,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${referralEarningsTable.amount}), 0)::float`,
    })
    .from(referralEarningsTable)
    .where(eq(referralEarningsTable.userId, userId))
    .groupBy(referralEarningsTable.level)
    .orderBy(asc(referralEarningsTable.level));

  // Direct referrals with per-user earnings rolled up from referral_earnings.
  const referredUsers = user?.referralCode
    ? await db
        .select({
          id: usersTable.id,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          phone: usersTable.phone,
          createdAt: usersTable.createdAt,
          totalEarned: sql<number>`coalesce(sum(case when ${referralEarningsTable.userId} = ${userId} then ${referralEarningsTable.amount} else 0 end), 0)::float`,
          earningsCount: sql<number>`count(${referralEarningsTable.id})::int`,
        })
        .from(usersTable)
        .leftJoin(
          referralEarningsTable,
          and(
            eq(referralEarningsTable.fromUserId, usersTable.id),
            eq(referralEarningsTable.userId, userId),
          ),
        )
        .where(eq(usersTable.referredByCode, user.referralCode))
        .groupBy(usersTable.id)
        .orderBy(desc(usersTable.createdAt))
    : [];

  const levels = await db
    .select()
    .from(referralLevelsTable)
    .orderBy(asc(referralLevelsTable.level));

  res.json({
    referralCode: user?.referralCode ?? null,
    totals: {
      total: totals.total,
      count: totals.count,
      byLevel,
    },
    referredUsers: referredUsers.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      level: 1,
      joinedAt: u.createdAt,
      totalEarned: u.totalEarned,
      earningsCount: u.earningsCount,
    })),
    levels: levels.map((l) => ({
      level: l.level,
      percentage: l.percentage,
      isActive: l.isActive,
    })),
  });
};

interface TreeNode {
  id: string;
  name: string;
  level: number;
  children: TreeNode[];
}

function formatName(u: {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}): string {
  const full = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return full || u.phone || "User";
}

const MAX_TREE_LEVELS = 3;

router.get("/referrals/tree", async (req, res): Promise<void> => {
  // Accept either a user or an admin bearer token; admins may pass ?userId=…
  // to view any user's tree, while regular users may only fetch their own.
  const token = extractBearer(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  const requestedUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  if (requestedUserId && !/^[0-9a-f-]{36}$/i.test(requestedUserId)) {
    res.status(400).json({ error: "invalid_user_id" });
    return;
  }

  let rootUserId: string;
  if (payload.kind === "admin") {
    const [a] = await db
      .select({ id: adminsTable.id })
      .from(adminsTable)
      .where(eq(adminsTable.id, payload.sub))
      .limit(1);
    if (!a) {
      res.status(401).json({ error: "admin_not_found" });
      return;
    }
    if (!requestedUserId) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    rootUserId = requestedUserId;
  } else {
    const [u] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, payload.sub))
      .limit(1);
    if (!u) {
      res.status(401).json({ error: "user_not_found" });
      return;
    }
    if (requestedUserId && requestedUserId !== payload.sub) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    rootUserId = payload.sub;
  }

  const [root] = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
      referralCode: usersTable.referralCode,
    })
    .from(usersTable)
    .where(eq(usersTable.id, rootUserId))
    .limit(1);

  if (!root) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  // Build the tree breadth-first. One DB round-trip per level (max 3),
  // never per-node, so the total cost stays bounded regardless of fanout.
  const visited = new Set<string>([root.id]);
  const nodesByCode = new Map<string, TreeNode[]>();
  const rootChildren: TreeNode[] = [];
  if (root.referralCode) nodesByCode.set(root.referralCode, rootChildren);

  let frontierCodes: string[] = root.referralCode ? [root.referralCode] : [];

  for (let level = 1; level <= MAX_TREE_LEVELS; level++) {
    if (frontierCodes.length === 0) break;
    const rows = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        referralCode: usersTable.referralCode,
        referredByCode: usersTable.referredByCode,
      })
      .from(usersTable)
      .where(inArray(usersTable.referredByCode, frontierCodes));

    const nextFrontier: string[] = [];
    const nextNodesByCode = new Map<string, TreeNode[]>();

    for (const r of rows) {
      if (visited.has(r.id) || !r.referredByCode) continue;
      visited.add(r.id);
      const parentChildren = nodesByCode.get(r.referredByCode);
      if (!parentChildren) continue;
      const node: TreeNode = {
        id: r.id,
        name: formatName(r),
        level,
        children: [],
      };
      parentChildren.push(node);
      if (level < MAX_TREE_LEVELS && r.referralCode) {
        nextNodesByCode.set(r.referralCode, node.children);
        nextFrontier.push(r.referralCode);
      }
    }

    frontierCodes = nextFrontier;
    nodesByCode.clear();
    for (const [code, arr] of nextNodesByCode) nodesByCode.set(code, arr);
  }

  res.json({
    user: { id: root.id, name: formatName(root) },
    children: rootChildren,
  });
});

// ---------------------------------------------------------------------------
// Admin MLM (3-level) referral report
// ---------------------------------------------------------------------------

router.get("/admin/mlm-report/search", requireAdmin, async (req, res): Promise<void> => {
  const parsed = z
    .object({ q: z.string().trim().min(1).max(100) })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const q = parsed.data.q;
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const rows = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
      email: usersTable.email,
      referralCode: usersTable.referralCode,
      appMode: usersTable.appMode,
      driverStatus: usersTable.driverStatus,
    })
    .from(usersTable)
    .where(
      or(
        ilike(usersTable.firstName, like),
        ilike(usersTable.lastName, like),
        sql`(${usersTable.firstName} || ' ' || coalesce(${usersTable.lastName}, '')) ilike ${like}`,
        ilike(usersTable.phone, like),
        ilike(usersTable.email, like),
        ilike(usersTable.referralCode, like),
      ),
    )
    .orderBy(desc(usersTable.createdAt))
    .limit(20);

  res.json({
    results: rows.map((r) => ({
      id: r.id,
      name: formatName(r),
      phone: r.phone ?? null,
      email: r.email ?? null,
      referralCode: r.referralCode ?? null,
      appMode: r.appMode,
      driverStatus: r.driverStatus,
    })),
  });
});

interface MlmUserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  referralCode: string | null;
  referredByCode: string | null;
  appMode: "rider" | "driver";
  driverStatus: string;
  isActive: boolean;
  createdAt: Date;
}

const MAX_MLM_REPORT_DEPTH = 6;
const DEFAULT_MLM_REPORT_DEPTH = 3;

router.get("/admin/mlm-report/:userId", requireAdmin, async (req, res): Promise<void> => {
  const userId = req.params.userId as string;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    res.status(400).json({ error: "invalid_user_id" });
    return;
  }

  const depthParsed = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_MLM_REPORT_DEPTH)
    .optional()
    .default(DEFAULT_MLM_REPORT_DEPTH)
    .safeParse(req.query.depth);
  if (!depthParsed.success) {
    res.status(400).json({ error: "invalid_depth" });
    return;
  }
  const depth = depthParsed.data;

  const [root] = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
      email: usersTable.email,
      referralCode: usersTable.referralCode,
      referredByCode: usersTable.referredByCode,
      appMode: usersTable.appMode,
      driverStatus: usersTable.driverStatus,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!root) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  // BFS up to `depth` levels, batched: one query per level. Cycle-safe via
  // `visited` (any user already placed in the tree is skipped on re-encounter).
  const visited = new Set<string>([root.id]);
  const usersByLevel: MlmUserRow[][] = Array.from({ length: depth }, () => []);
  // frontierCodes: referral codes whose direct referrals form the next BFS round.
  let frontierCodes: string[] = root.referralCode ? [root.referralCode] : [];

  for (let level = 1; level <= depth; level++) {
    if (frontierCodes.length === 0) break;
    const rows = (await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        email: usersTable.email,
        referralCode: usersTable.referralCode,
        referredByCode: usersTable.referredByCode,
        appMode: usersTable.appMode,
        driverStatus: usersTable.driverStatus,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(inArray(usersTable.referredByCode, frontierCodes))) as MlmUserRow[];

    const next: string[] = [];
    for (const r of rows) {
      if (!r.referredByCode) continue;
      if (visited.has(r.id)) continue;
      visited.add(r.id);
      usersByLevel[level - 1].push(r);
      if (level < depth && r.referralCode) next.push(r.referralCode);
    }
    frontierCodes = next;
  }

  const allDescendantIds = usersByLevel.flat().map((u) => u.id);

  // Per-user earnings totals (split by status) for every user in the
  // downline. Rolled up in a single query, indexed by userId.
  const earningsAgg =
    allDescendantIds.length > 0
      ? await db
          .select({
            userId: referralEarningsTable.userId,
            // Schema only stores 'credited' or 'reversed' rows. We treat
            // credited as both the total and the paid-out reward (the wallet
            // is credited the moment the row is inserted) and expose
            // pendingRewards = 0 because no async payout queue exists yet.
            totalEarnings: sql<number>`coalesce(sum(case when ${referralEarningsTable.status} = 'credited' then ${referralEarningsTable.amount} else 0 end), 0)::float`,
          })
          .from(referralEarningsTable)
          .where(inArray(referralEarningsTable.userId, allDescendantIds))
          .groupBy(referralEarningsTable.userId)
      : [];

  const earningsByUser = new Map<string, { totalEarnings: number }>();
  for (const row of earningsAgg) {
    earningsByUser.set(row.userId, { totalEarnings: row.totalEarnings });
  }

  // Direct-referral counts per user across the whole downline (covers root +
  // every node), in one query so the tree builder can read them in O(1).
  const allCodes = [
    ...(root.referralCode ? [root.referralCode] : []),
    ...usersByLevel.flat().map((u) => u.referralCode).filter((c): c is string => !!c),
  ];
  const directCounts = new Map<string, number>();
  if (allCodes.length > 0) {
    const rows = await db
      .select({
        code: usersTable.referredByCode,
        n: sql<number>`count(*)::int`,
      })
      .from(usersTable)
      .where(inArray(usersTable.referredByCode, allCodes))
      .groupBy(usersTable.referredByCode);
    for (const r of rows) if (r.code) directCounts.set(r.code, r.n);
  }

  // Build a parent lookup: child userId -> parent userId, by walking codes.
  // Root's referralCode → root.id; each descendant's referralCode → user.id.
  const userByCode = new Map<string, string>();
  if (root.referralCode) userByCode.set(root.referralCode, root.id);
  for (const u of usersByLevel.flat()) {
    if (u.referralCode) userByCode.set(u.referralCode, u.id);
  }

  interface MlmNode {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    appMode: "rider" | "driver";
    driverStatus: string;
    level: number;
    referralCode: string | null;
    referredByUserId: string | null;
    directReferrals: number;
    totalEarnings: number;
    paidRewards: number;
    pendingRewards: number;
    joinedAt: string;
    isActive: boolean;
    children: MlmNode[];
  }

  function nodeFor(u: MlmUserRow, level: number): MlmNode {
    const e = earningsByUser.get(u.id) ?? { totalEarnings: 0 };
    const parentId = u.referredByCode ? userByCode.get(u.referredByCode) ?? null : null;
    return {
      id: u.id,
      name: formatName(u),
      phone: u.phone,
      email: u.email,
      appMode: u.appMode,
      driverStatus: u.driverStatus,
      level,
      referralCode: u.referralCode,
      referredByUserId: parentId,
      directReferrals: u.referralCode ? directCounts.get(u.referralCode) ?? 0 : 0,
      totalEarnings: e.totalEarnings,
      // paid == total because the wallet is credited the moment a referral
      // earning row is inserted; pending stays 0 until an async payout
      // queue is introduced.
      paidRewards: e.totalEarnings,
      pendingRewards: 0,
      joinedAt: u.createdAt.toISOString(),
      isActive: u.isActive,
      children: [] as MlmNode[],
    };
  }

  // Index every level node by the parent code so we can attach children in O(1).
  // Level 1 nodes are the tree roots; levels 2..depth attach to their parent
  // (which lives at level - 1 and is therefore already in `nodesById`).
  const nodesById = new Map<string, MlmNode>();
  const tree: MlmNode[] = [];
  for (let level = 1; level <= depth; level++) {
    const generation = usersByLevel[level - 1] ?? [];
    for (const u of generation) {
      const n = nodeFor(u, level);
      nodesById.set(u.id, n);
      if (level === 1) {
        tree.push(n);
        continue;
      }
      if (!u.referredByCode) continue;
      const parentId = userByCode.get(u.referredByCode);
      const parent = parentId ? nodesById.get(parentId) : null;
      if (parent) parent.children.push(n);
    }
  }

  const levelCounts = usersByLevel.map((g) => g.length);
  const summary = {
    level1Count: levelCounts[0] ?? 0,
    level2Count: levelCounts[1] ?? 0,
    level3Count: levelCounts[2] ?? 0,
    levelCounts,
    totalEarnings: 0,
    paidRewards: 0,
    pendingRewards: 0,
  };
  for (const u of usersByLevel.flat()) {
    const e = earningsByUser.get(u.id);
    if (!e) continue;
    summary.totalEarnings += e.totalEarnings;
  }
  // See nodeFor() above for why paid == total and pending == 0.
  summary.paidRewards = summary.totalEarnings;

  req.log.info(
    {
      rootId: root.id,
      depth,
      levelCounts,
    },
    "[mlm-report] built referral tree",
  );

  res.json({
    root: {
      id: root.id,
      name: formatName(root),
      phone: root.phone,
      email: root.email,
      appMode: root.appMode,
      driverStatus: root.driverStatus,
      referralCode: root.referralCode,
      joinedAt: root.createdAt.toISOString(),
      isActive: root.isActive,
    },
    summary,
    depth,
    tree,
  });
});

router.get(
  "/admin/mlm-report/:userId/earnings",
  requireAdmin,
  async (req, res): Promise<void> => {
    const userId = req.params.userId as string;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const rows = await db
      .select({
        id: referralEarningsTable.id,
        rideId: referralEarningsTable.rideId,
        level: referralEarningsTable.level,
        percentage: referralEarningsTable.percentage,
        amount: referralEarningsTable.amount,
        status: referralEarningsTable.status,
        createdAt: referralEarningsTable.createdAt,
        fromUserId: referralEarningsTable.fromUserId,
        fromUserName: sql<
          string | null
        >`fu.first_name || ' ' || coalesce(fu.last_name, '')`,
        fromUserPhone: sql<string | null>`fu.phone`,
      })
      .from(referralEarningsTable)
      .leftJoin(
        sql`${usersTable} as fu`,
        sql`fu.id = ${referralEarningsTable.fromUserId}`,
      )
      .where(eq(referralEarningsTable.userId, userId))
      .orderBy(desc(referralEarningsTable.createdAt));

    let totalAmount = 0;
    for (const r of rows) {
      if (r.status === "credited") totalAmount += r.amount;
    }

    res.json({
      user: {
        id: user.id,
        name: formatName(user),
        phone: user.phone,
      },
      earnings: rows.map((r) => ({
        id: r.id,
        rideId: r.rideId,
        level: r.level,
        percentage: r.percentage,
        amount: r.amount,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        fromUserId: r.fromUserId,
        fromUserName: r.fromUserName?.trim() || null,
        fromUserPhone: r.fromUserPhone ?? null,
      })),
      totalAmount,
    });
  },
);

// Both paths point at the same handler. /referrals/me is the historical
// route the mobile + admin clients consume; /me/referrals matches the task
// contract so external consumers expecting the spec-shaped path also work.
router.get("/referrals/me", requireUser, meHandler);
router.get("/me/referrals", requireUser, meHandler);

export default router;
