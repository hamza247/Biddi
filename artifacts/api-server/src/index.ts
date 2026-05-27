import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { initIo, flushAllPositionsToDb } from "./lib/io";
import { ensureDefaultAdmin, ensureNotificationTemplates, ensureGeoFenceDefaults, ensureDefaultVehicleTypes, ensureIconUrlFormat, ensureDefaultAppClasses, ensureDefaultCurrencies } from "./lib/seed";
import { ensureSettingsSeeded } from "./lib/settings";
import { ensureReferralLevelsSeeded } from "./services/referrals";
import { ensureSitePagesSeeded } from "./lib/seedSite";
import { pollPushReceipts } from "./lib/push";
import { pollWeather, WEATHER_POLL_INTERVAL_MS } from "./lib/weather";
import { startCurrencyScheduler } from "./services/currencyService";
import { startBiddingExpiryJob, stopBiddingExpiryJob } from "./jobs/bidding-expiry";
import { closeRedis } from "./lib/redis";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
initIo(httpServer);

const RECEIPT_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Graceful shutdown: flush all in-memory driver positions to the DB so
// warmUpPositions can recover them on the next boot, even if they were
// received after the last throttled 30-second persist.
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, "graceful shutdown initiated — flushing live positions");
  try {
    await Promise.race([
      flushAllPositionsToDb(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } catch (err) {
    logger.error({ err }, "error flushing positions on shutdown");
  }
  // Stop BullMQ workers + queues so Redis connections close cleanly. Bounded
  // by the same 5s budget so a hung Redis can't block shutdown.
  try {
    await Promise.race([
      (async () => {
        await stopBiddingExpiryJob();
        await closeRedis();
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } catch (err) {
    logger.error({ err }, "error closing queue/redis on shutdown");
  }
  process.exit(0);
}

process.once("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.once("SIGINT", () => { void gracefulShutdown("SIGINT"); });

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  // Ensure default admin exists. Non-blocking; logs result.
  void ensureDefaultAdmin();
  // Ensure default app settings exist (sms mode, demo code).
  void ensureSettingsSeeded();
  // Ensure notification templates (push notification content).
  void ensureNotificationTemplates();
  // Ensure default countries exist and migrate legacy geo-fence types.
  void ensureGeoFenceDefaults();
  // Ensure vehicle types exist and classKey is backfilled on existing rows.
  void ensureDefaultVehicleTypes();
  // Normalise icon_url values to the canonical /api/storage/objects/uploads/<id> form.
  void ensureIconUrlFormat();
  // Ensure built-in app class keys (ride, comfort, moto) exist in the database.
  void ensureDefaultAppClasses();
  // Ensure 3-level referral percentages are seeded.
  void ensureReferralLevelsSeeded();
  // Seed default marketing-site pages (idempotent).
  void ensureSitePagesSeeded();
  // Ensure default currencies (USD/MAD/EUR), then start the daily rate
  // refresher so admin and apps see fresh display amounts. Fail-safe: a
  // refresh failure leaves prior rates in place and never crashes.
  void (async () => {
    await ensureDefaultCurrencies();
    startCurrencyScheduler();
  })();
  // Periodically poll Expo push receipts to catch delayed delivery failures.
  setInterval(() => {
    void pollPushReceipts();
  }, RECEIPT_POLL_INTERVAL_MS);
  logger.info({ intervalMs: RECEIPT_POLL_INTERVAL_MS }, "[push] push receipt polling scheduled");

  // Periodically refresh OpenWeather observations for active surcharge rules.
  // Fail-safe: if the API key is unset or there are no active rules, the
  // poll is a no-op so the server keeps running without weather pricing.
  void pollWeather();
  setInterval(() => {
    void pollWeather();
  }, WEATHER_POLL_INTERVAL_MS);
  logger.info(
    { intervalMs: WEATHER_POLL_INTERVAL_MS },
    "[weather] weather polling scheduled",
  );

  // Age out stale bidding offers (and bidding posts past their deadline).
  // Prefers BullMQ when REDIS_URL is set; falls back to setInterval otherwise.
  // Disabled by setting BIDDING_EXPIRY_DISABLED=true so Vitest can opt out.
  void startBiddingExpiryJob();
});
