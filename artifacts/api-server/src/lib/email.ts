import nodemailer from "nodemailer";
import { db, notificationTemplatesTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import { getConfig } from "./settings";

type TemplateVars = Record<string, string>;

function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const cfg = await getConfig();
  const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpSecure } = cfg;

  if (!smtpHost) {
    logger.warn("[email] smtpHost not configured — email not sent");
    throw new Error("Email service not configured. Set SMTP host in Settings or via SMTP_HOST environment variable.");
  }

  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort || 587,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  const from = smtpFrom || smtpUser || "noreply@biddi.app";
  await transport.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html });
  logger.info({ to: opts.to, subject: opts.subject }, "[email] sent");
}

/**
 * Send an email to a user using a stored notification template (type=email).
 * Template `title` is treated as the subject and `body` as the HTML body.
 * Both fields support `{{var}}` interpolation. Falls back to the supplied
 * defaults if the template is missing/inactive. Silently no-ops (with a log
 * line) if the user has no email address on file or SMTP is not configured.
 */
export async function sendEmailFromTemplate(
  userId: string,
  templateKey: string,
  defaultSubject: string,
  defaultHtml: string,
  extraVars?: TemplateVars,
): Promise<void> {
  let subject = defaultSubject;
  let html = defaultHtml;

  try {
    const [tmpl] = await db
      .select()
      .from(notificationTemplatesTable)
      .where(
        and(
          eq(notificationTemplatesTable.key, templateKey),
          eq(notificationTemplatesTable.type, "email"),
          eq(notificationTemplatesTable.active, true),
        ),
      )
      .limit(1);
    if (tmpl) {
      subject = tmpl.title;
      html = tmpl.body;
    }
  } catch (err) {
    logger.warn({ err, templateKey }, "[email] failed to load template — using defaults");
  }

  let vars: TemplateVars = {};
  let to: string | null = null;
  try {
    const [user] = await db
      .select({
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (user) {
      to = user.email ?? null;
      const fullName = `${user.firstName} ${user.lastName}`.trim();
      vars = {
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        phone: user.phone,
      };
    }
  } catch (err) {
    logger.warn({ err, userId }, "[email] failed to load user for template");
    return;
  }

  if (!to) {
    logger.info({ userId, templateKey }, "[email] user has no email — skipping");
    return;
  }

  if (extraVars) vars = { ...vars, ...extraVars };

  try {
    await sendEmail({
      to,
      subject: interpolate(subject, vars),
      html: interpolate(html, vars),
    });
  } catch (err) {
    logger.error({ err, userId, templateKey }, "[email] failed to send templated email");
  }
}
