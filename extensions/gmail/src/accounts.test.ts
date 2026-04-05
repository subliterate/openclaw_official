import { describe, expect, it, vi, afterEach } from "vitest";
import {
  listGmailAccountIds,
  resolveDefaultGmailAccountId,
  resolveGmailAccount,
} from "./accounts.js";
import type { GmailConfig } from "./types.js";

type CoreConfig = { channels?: { gmail?: GmailConfig }; [key: string]: unknown };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listGmailAccountIds", () => {
  it("returns [default] when no accounts configured", () => {
    const cfg = {} as CoreConfig;
    expect(listGmailAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns configured account IDs", () => {
    const cfg = {
      channels: {
        gmail: {
          accounts: {
            work: { clientId: "id1" },
            personal: { clientId: "id2" },
          },
        },
      },
    } as CoreConfig;

    const ids = listGmailAccountIds(cfg);
    expect(ids).toContain("work");
    expect(ids).toContain("personal");
    expect(ids).toHaveLength(2);
  });
});

describe("resolveDefaultGmailAccountId", () => {
  it("returns default when no accounts configured", () => {
    expect(resolveDefaultGmailAccountId({} as CoreConfig)).toBe("default");
  });
});

describe("resolveGmailAccount", () => {
  it("resolves from config fields", () => {
    const cfg = {
      channels: {
        gmail: {
          clientId: "test-client-id",
          clientSecret: "test-secret",
          refreshToken: "test-refresh",
        },
      },
    } as CoreConfig;

    const account = resolveGmailAccount({ cfg });

    expect(account.configured).toBe(true);
    expect(account.clientId).toBe("test-client-id");
    expect(account.clientSecret).toBe("test-secret");
    expect(account.refreshToken).toBe("test-refresh");
  });

  it("resolves from environment variables for default account", () => {
    vi.stubEnv("GMAIL_CLIENT_ID", "env-client-id");
    vi.stubEnv("GMAIL_CLIENT_SECRET", "env-secret");
    vi.stubEnv("GMAIL_REFRESH_TOKEN", "env-refresh");

    const account = resolveGmailAccount({ cfg: {} as CoreConfig });

    expect(account.configured).toBe(true);
    expect(account.clientId).toBe("env-client-id");
    expect(account.clientSecret).toBe("env-secret");
    expect(account.refreshToken).toBe("env-refresh");
  });

  it("is not configured when credentials are missing", () => {
    const account = resolveGmailAccount({ cfg: {} as CoreConfig });

    expect(account.configured).toBe(false);
  });

  it("merges account-specific overrides", () => {
    const cfg = {
      channels: {
        gmail: {
          clientId: "base-id",
          clientSecret: "base-secret",
          refreshToken: "base-refresh",
          accounts: {
            work: {
              refreshToken: "work-refresh",
              name: "Work Gmail",
            },
          },
        },
      },
    } as CoreConfig;

    const account = resolveGmailAccount({ cfg, accountId: "work" });

    expect(account.configured).toBe(true);
    expect(account.clientId).toBe("base-id");
    expect(account.refreshToken).toBe("work-refresh");
    expect(account.name).toBe("Work Gmail");
  });

  it("respects enabled: false", () => {
    const cfg = {
      channels: {
        gmail: {
          enabled: false,
          clientId: "id",
          clientSecret: "secret",
          refreshToken: "refresh",
        },
      },
    } as CoreConfig;

    const account = resolveGmailAccount({ cfg });
    expect(account.enabled).toBe(false);
  });
});
