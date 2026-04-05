import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, getAccessToken } from "./auth.js";
import type { ResolvedGmailAccount } from "./types.js";

const mockAccount: ResolvedGmailAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  email: "test@gmail.com",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
  config: {},
};

describe("getAccessToken", () => {
  beforeEach(() => {
    clearTokenCache("default");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "fresh-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges refresh token for access token", async () => {
    const token = await getAccessToken(mockAccount);

    expect(token).toBe("fresh-access-token");
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[0]).toBe("https://oauth2.googleapis.com/token");
    const body = call[1]?.body as string;
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=test-client-id");
  });

  it("returns cached token on second call", async () => {
    const token1 = await getAccessToken(mockAccount);
    const token2 = await getAccessToken(mockAccount);

    expect(token1).toBe("fresh-access-token");
    expect(token2).toBe("fresh-access-token");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("clears cache and re-fetches after clearTokenCache", async () => {
    await getAccessToken(mockAccount);
    clearTokenCache("default");
    await getAccessToken(mockAccount);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on transient failure", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return { ok: false, text: async () => "server error", status: 500 };
        }
        return {
          ok: true,
          json: async () => ({
            access_token: "recovered-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        };
      }),
    );

    const token = await getAccessToken(mockAccount);
    expect(token).toBe("recovered-token");
    expect(callCount).toBe(3);
  });

  it("throws after max retries exhausted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "invalid_grant",
      }),
    );

    await expect(getAccessToken(mockAccount)).rejects.toThrow(/Token refresh failed/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
