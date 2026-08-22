import type { GmailTokens, ResolvedGmailAccount } from "./types.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry.

// In-memory token cache keyed by accountId.
const tokenCache = new Map<string, GmailTokens>();

/**
 * Exchange a refresh token for a fresh access token.
 */
async function exchangeRefreshToken(account: ResolvedGmailAccount): Promise<GmailTokens> {
  const body = new URLSearchParams({
    client_id: account.clientId,
    client_secret: account.clientSecret,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token",
  });

  let lastError: Error | undefined;
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Token refresh failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as {
        access_token: string;
        expires_in: number;
        token_type: string;
      };

      return {
        accessToken: json.access_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        refreshToken: account.refreshToken,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s.
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }

  throw lastError ?? new Error("Token refresh failed after retries");
}

/**
 * Get a valid access token for the given account.
 * Uses in-memory cache and refreshes automatically when expired.
 */
export async function getAccessToken(account: ResolvedGmailAccount): Promise<string> {
  const cached = tokenCache.get(account.accountId);
  if (cached && cached.expiresAt - TOKEN_EXPIRY_BUFFER_MS > Date.now()) {
    return cached.accessToken;
  }

  const tokens = await exchangeRefreshToken(account);
  tokenCache.set(account.accountId, tokens);
  return tokens.accessToken;
}

/**
 * Clear the token cache for an account (e.g. on revocation).
 */
export function clearTokenCache(accountId: string): void {
  tokenCache.delete(accountId);
}
