// src/modules/librarySearch/recordUtils.ts
//
// Pure helpers for pulling well-formed identifiers out of noisy catalog data.
// The DC/OAI `identifier` field is a free-text grab-bag — ISBNs sit next to
// price qualifiers ("978-3-16-148410-0 : EUR 24.00"), URNs, and DOIs — so a
// loose "10+ digits" match produces false positives. These validate structure
// AND checksum, and are unit-tested offline.

/** ISBN-10 checksum (mod 11, last digit may be X). Input: 10 chars, no separators. */
export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = s[i] === "X" ? 10 : s.charCodeAt(i) - 48;
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

/** ISBN-13 checksum (mod 10, EAN weights 1/3). Input: 13 digits, no separators. */
export function isValidIsbn13(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += (s.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

/** ISSN checksum (mod 11, last digit may be X). Input: 8 chars, no separators. */
export function isValidIssn(s: string): boolean {
  if (!/^\d{7}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const v = s[i] === "X" ? 10 : s.charCodeAt(i) - 48;
    sum += v * (8 - i);
  }
  return sum % 11 === 0;
}

/**
 * Extract a normalized (hyphen-free, upper-case) ISBN-10 or ISBN-13 from free
 * text, or null. A candidate must have valid length AND a valid checksum, which
 * rejects DOIs, URNs, and arbitrary long digit runs.
 */
export function extractIsbn(text: string): string | null {
  if (!text) return null;
  const candidates = text.match(/[0-9][0-9\- ]{8,}[0-9Xx]/g);
  if (!candidates) return null;
  for (const c of candidates) {
    const digits = c.replace(/[\s-]/g, "").toUpperCase();
    if (
      (digits.length === 10 && isValidIsbn10(digits)) ||
      (digits.length === 13 && isValidIsbn13(digits))
    ) {
      return digits;
    }
  }
  return null;
}

/**
 * Extract a normalized ISSN (`NNNN-NNNC`) from free text, or null. Requires the
 * canonical 4-4 shape and a valid checksum, so a bare "2024-01" date or a phone
 * number won't match.
 */
export function extractIssn(text: string): string | null {
  if (!text) return null;
  const re = /\b(\d{4})-?(\d{3}[\dXx])\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const compact = (m[1] + m[2]).toUpperCase();
    if (isValidIssn(compact)) {
      return `${compact.slice(0, 4)}-${compact.slice(4)}`;
    }
  }
  return null;
}
