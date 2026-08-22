import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/core";
import type { GmailAccountConfig, GmailConfig, ResolvedGmailAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { gmail?: GmailConfig };
};

function mergeGmailAccountConfig(cfg: CoreConfig, accountId: string): GmailAccountConfig {
  const base = cfg.channels?.gmail ?? {};
  const { accounts: _, ...baseFields } = base;
  const accountOverrides = base.accounts?.[accountId] ?? {};
  return { ...baseFields, ...accountOverrides };
}

function listConfiguredAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.gmail?.accounts;
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

export function listGmailAccountIds(cfg: CoreConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultGmailAccountId(cfg: CoreConfig): string {
  const ids = listGmailAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveGmailAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedGmailAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.gmail?.enabled !== false;

  const resolve = (accountId: string): ResolvedGmailAccount => {
    const merged = mergeGmailAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    // Resolve credentials from config or env (env vars for default account only).
    const isDefault = accountId === DEFAULT_ACCOUNT_ID;
    const clientId =
      merged.clientId?.trim() || (isDefault ? process.env.GMAIL_CLIENT_ID?.trim() : "") || "";
    const clientSecret =
      merged.clientSecret?.trim() ||
      (isDefault ? process.env.GMAIL_CLIENT_SECRET?.trim() : "") ||
      "";
    const refreshToken =
      merged.refreshToken?.trim() ||
      (isDefault ? process.env.GMAIL_REFRESH_TOKEN?.trim() : "") ||
      "";

    // Email address is obtained from the profile API at runtime;
    // we store an empty string here until first probe/token exchange.
    const email = isDefault ? (process.env.GMAIL_EMAIL?.trim() ?? "") : "";

    const configured = Boolean(clientId && clientSecret && refreshToken);

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured,
      email,
      clientId,
      clientSecret,
      refreshToken,
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
  const fallbackId = resolveDefaultGmailAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  return fallback.configured ? fallback : primary;
}
