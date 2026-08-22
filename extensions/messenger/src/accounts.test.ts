import { describe, expect, it, vi, afterEach } from "vitest";
import {
  listMessengerAccountIds,
  resolveDefaultMessengerAccountId,
  resolveMessengerAccount,
} from "./accounts.js";
import type { MessengerConfig } from "./types.js";

type CoreConfig = { channels?: { messenger?: MessengerConfig }; [key: string]: unknown };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listMessengerAccountIds", () => {
  it("returns [default] when no accounts configured", () => {
    const cfg = {} as CoreConfig;
    expect(listMessengerAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns configured account IDs", () => {
    const cfg = {
      channels: {
        messenger: {
          accounts: {
            page1: { pageAccessToken: "tok1" },
            page2: { pageAccessToken: "tok2" },
          },
        },
      },
    } as CoreConfig;

    const ids = listMessengerAccountIds(cfg);
    expect(ids).toContain("page1");
    expect(ids).toContain("page2");
    expect(ids).toHaveLength(2);
  });
});

describe("resolveDefaultMessengerAccountId", () => {
  it("returns default when no accounts configured", () => {
    expect(resolveDefaultMessengerAccountId({} as CoreConfig)).toBe("default");
  });
});

describe("resolveMessengerAccount", () => {
  it("resolves from config fields", () => {
    const cfg = {
      channels: {
        messenger: {
          pageAccessToken: "test-page-token",
          appSecret: "test-app-secret",
          verifyToken: "test-verify-token",
        },
      },
    } as CoreConfig;

    const account = resolveMessengerAccount({ cfg });

    expect(account.configured).toBe(true);
    expect(account.pageAccessToken).toBe("test-page-token");
    expect(account.appSecret).toBe("test-app-secret");
    expect(account.verifyToken).toBe("test-verify-token");
  });

  it("resolves from environment variables for default account", () => {
    vi.stubEnv("MESSENGER_PAGE_ACCESS_TOKEN", "env-page-token");
    vi.stubEnv("MESSENGER_APP_SECRET", "env-app-secret");
    vi.stubEnv("MESSENGER_VERIFY_TOKEN", "env-verify-token");

    const account = resolveMessengerAccount({ cfg: {} as CoreConfig });

    expect(account.configured).toBe(true);
    expect(account.pageAccessToken).toBe("env-page-token");
    expect(account.appSecret).toBe("env-app-secret");
    expect(account.verifyToken).toBe("env-verify-token");
  });

  it("is not configured when credentials are missing", () => {
    const account = resolveMessengerAccount({ cfg: {} as CoreConfig });

    expect(account.configured).toBe(false);
  });

  it("merges account-specific overrides", () => {
    const cfg = {
      channels: {
        messenger: {
          pageAccessToken: "base-token",
          appSecret: "base-secret",
          verifyToken: "base-verify",
          accounts: {
            page2: {
              pageAccessToken: "page2-token",
              name: "Page 2",
            },
          },
        },
      },
    } as CoreConfig;

    const account = resolveMessengerAccount({ cfg, accountId: "page2" });

    expect(account.configured).toBe(true);
    expect(account.pageAccessToken).toBe("page2-token");
    expect(account.appSecret).toBe("base-secret");
    expect(account.name).toBe("Page 2");
  });

  it("respects enabled: false", () => {
    const cfg = {
      channels: {
        messenger: {
          enabled: false,
          pageAccessToken: "tok",
          appSecret: "secret",
          verifyToken: "verify",
        },
      },
    } as CoreConfig;

    const account = resolveMessengerAccount({ cfg });
    expect(account.enabled).toBe(false);
  });

  it("uses default webhook path when none specified", () => {
    const account = resolveMessengerAccount({ cfg: {} as CoreConfig });
    expect(account.webhookPath).toBe("/webhook/messenger");
  });
});
