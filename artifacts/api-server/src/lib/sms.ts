import { logger } from "./logger";
import { getConfig, type SmsMode } from "./settings";

export interface OtpGen {
  code: string;
  reveal: boolean;
  mode: SmsMode;
}

export async function generateOtpForPhone(_phone: string): Promise<OtpGen> {
  const cfg = await getConfig();
  if (cfg.smsMode === "demo_fixed") {
    return { code: cfg.smsDemoCode || "1122", reveal: true, mode: "demo_fixed" };
  }
  if (cfg.smsMode === "demo_random") {
    return { code: String(Math.floor(1000 + Math.random() * 9000)), reveal: true, mode: "demo_random" };
  }
  return { code: String(Math.floor(1000 + Math.random() * 9000)), reveal: false, mode: cfg.smsMode };
}

export async function sendOtpSms(phone: string, code: string, mode: SmsMode): Promise<void> {
  if (mode === "demo_fixed" || mode === "demo_random") {
    logger.info({ phone, code, mode }, "[sms] mock OTP");
    return;
  }
  if (mode === "twilio") {
    return sendTwilio(phone, code);
  }
  if (mode === "moroccansms") {
    return sendMoroccanSms(phone, code);
  }
}

async function sendTwilio(phone: string, code: string): Promise<void> {
  const cfg = await getConfig();
  const sid = cfg.twilioAccountSid;
  const token = cfg.twilioAuthToken;
  const from = cfg.twilioFromNumber;
  if (!sid || !token || !from) {
    logger.warn({ phone }, "[sms] twilio mode but credentials missing — OTP not delivered");
    return;
  }
  try {
    const body = new URLSearchParams({ To: phone, From: from, Body: `Your Biddi code is ${code}` });
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const text = await r.text();
      logger.error({ phone, status: r.status, text }, "[sms] twilio send failed");
      return;
    }
    logger.info({ phone }, "[sms] twilio OTP sent");
  } catch (err) {
    logger.error({ err, phone }, "[sms] twilio request error");
  }
}

// MoroccanSMS expects MSISDN in international format without "+" — e.g. "212600000000".
// Accepts: "+212600000000", "212600000000", "0600000000", "600000000", "+15550000777" (where
// "1" was wrongly prepended by US-default normalization). Always returns "<prefix><subscriber>".
export function toMoroccanLocal(phone: string, prefix: string): string {
  let digits = phone.replace(/\D/g, "");
  const p = (prefix || "").replace(/\D/g, "");
  if (!p) return digits;
  // Already in correct international format.
  if (digits.startsWith(p)) return digits;
  // Local Moroccan format: drop the trunk "0".
  if (digits.startsWith("0")) digits = digits.slice(1);
  // US-default mis-normalization "1" + 10 digits: drop the bogus "1".
  else if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return `${p}${digits}`;
}

async function sendMoroccanSms(phone: string, code: string): Promise<void> {
  const cfg = await getConfig();
  const token = cfg.moroccansmsToken;
  if (!token) {
    logger.warn({ phone }, "[sms] moroccansms mode but token missing — OTP not delivered");
    return;
  }
  const tel = toMoroccanLocal(phone, cfg.moroccansmsPrefix || "212");
  const sender = cfg.moroccansmsSender || "Biddi";
  try {
    const body = new URLSearchParams({
      token,
      tel,
      message: `${sender}: votre code est ${code}`,
      ...(sender ? { sender } : {}),
    });
    const r = await fetch("https://bulksms.ma/developer/sms/send", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await r.text();
    if (!r.ok) {
      logger.error({ phone, status: r.status, text }, "[sms] moroccansms send failed");
      return;
    }
    logger.info({ phone, response: text.slice(0, 200) }, "[sms] moroccansms OTP sent");
  } catch (err) {
    logger.error({ err, phone }, "[sms] moroccansms request error");
  }
}
