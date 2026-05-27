import Stripe from "stripe";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const STRIPE_API_VERSION = "2024-12-18.acacia" as Stripe.LatestApiVersion;

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — required for payments routes",
    );
  }
  _stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });
  return _stripe;
}

export function getStripeWebhookSecret(): string {
  const v = process.env.STRIPE_WEBHOOK_SECRET;
  if (!v) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set — required to verify webhook signatures",
    );
  }
  return v;
}

export const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? "";

export async function getOrCreateCustomer(userId: string): Promise<string> {
  const [user] = await db
    .select({
      id: usersTable.id,
      stripeCustomerId: usersTable.stripeCustomerId,
      email: usersTable.email,
      phone: usersTable.phone,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    throw new Error(`user_not_found:${userId}`);
  }

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await getStripe().customers.create({
    email: user.email ?? undefined,
    phone: user.phone,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
    metadata: { userId: user.id },
  });

  await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(usersTable.id, userId));

  return customer.id;
}

export async function getOrCreateConnectAccount(
  driverId: string,
  options: { country?: string; email?: string | null } = {},
): Promise<string> {
  const [driver] = await db
    .select({
      id: usersTable.id,
      stripeConnectAccountId: usersTable.stripeConnectAccountId,
      email: usersTable.email,
      phone: usersTable.phone,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      country: usersTable.country,
    })
    .from(usersTable)
    .where(eq(usersTable.id, driverId))
    .limit(1);

  if (!driver) {
    throw new Error(`driver_not_found:${driverId}`);
  }

  if (driver.stripeConnectAccountId) {
    return driver.stripeConnectAccountId;
  }

  const account = await getStripe().accounts.create({
    type: "express",
    country: options.country ?? driver.country ?? "US",
    email: options.email ?? driver.email ?? undefined,
    capabilities: {
      transfers: { requested: true },
    },
    metadata: { driverId: driver.id },
    business_type: "individual",
    individual: {
      first_name: driver.firstName || undefined,
      last_name: driver.lastName || undefined,
      email: driver.email ?? undefined,
      phone: driver.phone,
    },
  });

  await db
    .update(usersTable)
    .set({ stripeConnectAccountId: account.id })
    .where(eq(usersTable.id, driverId));

  return account.id;
}

export async function refreshConnectAccountCapabilities(
  driverId: string,
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean }> {
  const [driver] = await db
    .select({ stripeConnectAccountId: usersTable.stripeConnectAccountId })
    .from(usersTable)
    .where(eq(usersTable.id, driverId))
    .limit(1);

  if (!driver?.stripeConnectAccountId) {
    return { chargesEnabled: false, payoutsEnabled: false };
  }

  const account = await getStripe().accounts.retrieve(
    driver.stripeConnectAccountId,
  );
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);

  await db
    .update(usersTable)
    .set({
      stripeConnectChargesEnabled: chargesEnabled,
      stripeConnectPayoutsEnabled: payoutsEnabled,
    })
    .where(eq(usersTable.id, driverId));

  return { chargesEnabled, payoutsEnabled };
}
