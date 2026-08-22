const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check if a string looks like an email address target.
 */
export function looksLikeGmailTarget(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  // Strip gmail: prefix if present.
  const target = trimmed.toLowerCase().startsWith("gmail:")
    ? trimmed.slice("gmail:".length).trim()
    : trimmed;

  return EMAIL_RE.test(target);
}

/**
 * Normalize a Gmail messaging target (email address).
 * Returns undefined if the input is not a valid email.
 */
export function normalizeGmailTarget(raw: string): string | undefined {
  let target = raw.trim();
  if (!target) {
    return undefined;
  }

  // Strip prefixes.
  for (const prefix of ["gmail:", "email:", "mailto:", "user:"]) {
    if (target.toLowerCase().startsWith(prefix)) {
      target = target.slice(prefix.length).trim();
      break;
    }
  }

  // Extract from angle brackets: "Name <email@example.com>".
  const bracketMatch = target.match(/<([^>]+)>/);
  if (bracketMatch) {
    target = bracketMatch[1]!.trim();
  }

  if (!EMAIL_RE.test(target)) {
    return undefined;
  }

  return target.toLowerCase();
}
