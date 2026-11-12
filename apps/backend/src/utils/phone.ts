/**
 * Phone number helpers for WhatsApp ordering.
 *
 * Numbers are stored digits-only in international format (e.g. 923001234567).
 * Pakistani local numbers (03xx / 3xx / 0092…) are converted to the 92 form.
 */

/** Extract digits from any user input, dropping leading zeros / + / separators. */
export function digitsOnly(input: string): string {
  return String(input || '').replace(/\D+/g, '');
}

/**
 * Normalize a phone number to digits-only international form.
 * - "03001234567"  -> "923001234567"
 * - "+92 300 1234567" -> "923001234567"
 * - "923001234567" -> "923001234567"
 * - "00923001234567" -> "923001234567"
 * Returns null when the input cannot be interpreted as a valid international
 * number (7–15 digits after normalization).
 */
export function normalizePhone(raw: string): string | null {
  let d = digitsOnly(raw);
  if (!d) return null;

  if (d.startsWith('00')) d = d.slice(2);

  // Pakistani local mobile numbers: 03xxxxxxxxx (11 digits) or 3xxxxxxxxx (10)
  if (/^0?3\d{9}$/.test(d) && d.length >= 10 && d.length <= 11) {
    d = '92' + d.replace(/^0/, '');
    return d;
  }

  // Pakistani numbers already with country code
  if (/^92\d{10}$/.test(d)) return d;

  // Generic international: allow 7–15 digits
  if (d.length < 7 || d.length > 15) return null;
  return d;
}

/** Strict validation used for the business WhatsApp number and customer phones. */
export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}

/** Formats digits-only number as readable +CC XXXXXXXXXX (best effort). */
export function formatPhoneDisplay(digits: string): string {
  return '+' + digits;
}
