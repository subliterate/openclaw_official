/**
 * Normalize a Messenger target (PSID — Page-Scoped User ID).
 * PSIDs are numeric strings.
 */
export function normalizeMessengerTarget(raw: string): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  let cleaned = raw.trim();

  // Strip common prefixes.
  for (const prefix of ["messenger:", "fb:", "psid:"]) {
    if (cleaned.toLowerCase().startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
      break;
    }
  }

  // PSIDs are numeric.
  if (!/^\d+$/.test(cleaned)) {
    return undefined;
  }

  return cleaned;
}

/**
 * Returns true if the input looks like a Messenger PSID.
 */
export function looksLikeMessengerTarget(raw: string): boolean {
  return normalizeMessengerTarget(raw) !== null;
}
