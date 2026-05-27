/**
 * Formats an E.164 phone number for human-readable display.
 * - US/Canada (+1):      +1 (XXX) XXX-XXXX
 * - Egypt (+20):         +20 XXX XXX XXXX
 * - Germany (+49):       +49 XXX XXXXXXX  (10-digit NSN, e.g. 17x mobile)
 *                        +49 XXXX XXXXXXX (11-digit NSN, e.g. 015x mobile)
 * - Morocco (+212):      +212 XXX-XXX-XXX
 * - France (+33):        +33 X XX XX XX XX
 * - UK (+44):            +44 XXXX XXXXXX
 * - Saudi Arabia (+966): +966 XX XXX XXXX
 * - UAE (+971):          +971 XX XXX XXXX
 * - Anything else:       returned as-is (raw E.164)
 */
export function formatPhoneDisplay(e164: string): string {
  if (e164.startsWith("+1")) {
    const digits = e164.slice(2).replace(/\D/g, "");
    if (digits.length === 10) {
      return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
  }

  if (e164.startsWith("+20")) {
    const digits = e164.slice(3).replace(/\D/g, "");
    if (digits.length === 10) {
      return `+20 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    }
  }

  if (e164.startsWith("+49")) {
    const digits = e164.slice(3).replace(/\D/g, "");
    // German mobile numbers only: 10-digit NSN (16x/17x) and 11-digit NSN (015x).
    // Other German number types (landline, special) fall back to raw E.164.
    if (digits.length === 10) {
      return `+49 ${digits.slice(0, 3)} ${digits.slice(3)}`;
    }
    if (digits.length === 11) {
      return `+49 ${digits.slice(0, 4)} ${digits.slice(4)}`;
    }
  }

  if (e164.startsWith("+212")) {
    const digits = e164.slice(4).replace(/\D/g, "");
    if (digits.length === 9) {
      return `+212 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
  }

  if (e164.startsWith("+44")) {
    const digits = e164.slice(3).replace(/\D/g, "");
    if (digits.length === 10) {
      return `+44 ${digits.slice(0, 4)} ${digits.slice(4)}`;
    }
  }

  if (e164.startsWith("+33")) {
    const digits = e164.slice(3).replace(/\D/g, "");
    if (digits.length === 9) {
      return `+33 ${digits[0]} ${digits.slice(1, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`;
    }
  }

  if (e164.startsWith("+966")) {
    const digits = e164.slice(4).replace(/\D/g, "");
    if (digits.length === 9) {
      return `+966 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
    }
  }

  if (e164.startsWith("+971")) {
    const digits = e164.slice(4).replace(/\D/g, "");
    if (digits.length === 9) {
      return `+971 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
    }
  }

  return e164;
}
