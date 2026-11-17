/**
 * Phone number helpers for WhatsApp ordering.
 *
 * Numbers are stored digits-only in international format (e.g. 923001234567).
 * Pakistani local numbers (03xx / 3xx / 0092…) are converted to the 92 form.
 * Customers must provide a mobile number — landlines and short local numbers
 * are rejected so WhatsApp links always point at a reachable phone.
 */

/** Message shown when a customer/business phone number is not a mobile number. */
export const PHONE_FORMAT_ERROR = 'Enter a mobile number like 0300 1234567';

/** Extract digits from any user input, dropping + / separators. */
export function digitsOnly(input: string): string {
  return String(input || '').replace(/\D+/g, '');
}

/**
 * Normalize a phone number to digits-only international form.
 * - "03001234567"    -> "923001234567"
 * - "3001234567"     -> "923001234567"
 * - "+92 300 1234567"-> "923001234567"
 * - "+92 0300 1234567" -> "923001234567" (extra leading 0 removed)
 * - "92 0300 1234567" -> "923001234567"
 * - "00923001234567" -> "923001234567"
 * - "923001234567"   -> "923001234567"
 * Returns null when the input is not a mobile number with a valid country
 * code and 10–15 digits total.
 */
export function normalizePhone(raw: string): string | null {
  let d = digitsOnly(raw);
  if (!d) return null;

  // International prefix written as 00 instead of +.
  if (d.startsWith('00')) d = d.slice(2);

  // Pakistani local mobiles: 03xxxxxxxxx (11 digits) or 3xxxxxxxxx (10).
  if (/^0?3\d{9}$/.test(d)) {
    return '92' + d.replace(/^0/, '');
  }

  // "+92 0300 …" / "92 0300 …": drop the extra 0 after the country code,
  // then apply the same mobile-only rule as every other 92-prefixed number.
  if (/^920\d{10}$/.test(d)) {
    d = '92' + d.slice(3);
  }

  // Pakistan is mobile-only for WhatsApp orders: 923xxxxxxxxx. Landlines
  // (+92 42 …), too-short local parts and other malformed values are rejected
  // instead of slipping through as "generic international" numbers.
  if (d.startsWith('92')) {
    return /^923\d{9}$/.test(d) ? d : null;
  }

  // Generic international numbers: leading country code (never 0) and
  // 10–15 digits total. Anything shorter is a local/landline number.
  if (/^[1-9]\d{9,14}$/.test(d)) return d;

  return null;
}

/** Strict validation used for the business WhatsApp number and customer phones. */
export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}

/** Formats digits-only number as readable +CC XXXXXXXXXX (best effort). */
export function formatPhoneDisplay(digits: string): string {
  return '+' + digits;
}
