import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/core";
import type { MessengerAccountConfig, MessengerConfig, ResolvedMessengerAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { messenger?: MessengerConfig };
};

function mergeMessengerAccountConfig(cfg: CoreConfig, accountId: string): MessengerAccountConfig {
  const base = cfg.channels?.messenger ?? {};
  const { accounts: _, ...baseFields } = base;
  const accountOverrides = base.accounts?.[accountId] ?? {};
  return { ...baseFields, ...accountOverrides };
}

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.messenger?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  const ids = new Set<string>();
  for (const key of Object.keys(accounts)) {
    if (key.trim()) {
      ids.add(normalizeAccountId(key));
    }
  }
  return [...ids];
}

export function listMessengerAccountIds(cfg: CoreConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultMessengerAccountId(cfg: CoreConfig): string {
  const ids = listMessengerAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveMessengerAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedMessengerAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.messenger?.enabled !== false;

  const resolve = (accountId: string): ResolvedMessengerAccount => {
    const merged = mergeMessengerAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    // Resolve credentials from config or env (env vars for default account only).
    const isDefault = accountId === DEFAULT_ACCOUNT_ID;
    const pageAccessToken =
      merged.pageAccessToken?.trim() ||
      (isDefault ? process.env.MESSENGER_PAGE_ACCESS_TOKEN?.trim() : "") ||
      "";
    const appSecret =
      merged.appSecret?.trim() || (isDefault ? process.env.MESSENGER_APP_SECRET?.trim() : "") || "";
    const verifyToken =
      merged.verifyToken?.trim() ||
      (isDefault ? process.env.MESSENGER_VERIFY_TOKEN?.trim() : "") ||
      "";

    const webhookPath = merged.webhookPath?.trim() || "/webhook/messenger";

    const configured = Boolean(pageAccessToken && appSecret && verifyToken);

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured,
      pageAccessToken,
      appSecret,
      verifyToken,
      webhookPath,
      config: merged,
    };
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.configured) {
    return primary;
  }
  const fallbackId = resolveDefaultMessengerAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  return fallback.configured ? fallback : primary;
}
