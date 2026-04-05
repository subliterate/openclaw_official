import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { createScopedDmSecurityResolver } from "openclaw/plugin-sdk/channel-config-helpers";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import {
  listGmailAccountIds,
  resolveDefaultGmailAccountId,
  resolveGmailAccount,
} from "./accounts.js";
// Actions disabled: upstream ChannelMessageActionAdapter API changed (describeMessageTool).
// import { gmailActions } from "./actions.js";
import { probeGmail } from "./api.js";
import { GmailConfigSchema } from "./config-schema.js";
import { handleGmailInbound } from "./inbound.js";
import { monitorGmailProvider } from "./monitor.js";
import { looksLikeGmailTarget, normalizeGmailTarget } from "./normalize.js";
import { getGmailRuntime } from "./runtime.js";
import { sendMessageGmail } from "./send.js";
import type { GmailConfig, GmailProbe, ResolvedGmailAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { gmail?: GmailConfig };
};

const DEFAULT_ACCOUNT_ID = "default";

const meta = {
  id: "gmail" as const,
  label: "Gmail",
  selectionLabel: "Gmail",
  docsPath: "/channels/gmail",
  blurb: "Send and receive email via Gmail.",
};

function setGmailAccountEnabled(params: {
  cfg: OpenClawConfig;
  accountId: string;
  enabled: boolean;
}): OpenClawConfig {
  const accountKey = params.accountId || DEFAULT_ACCOUNT_ID;
  const channels = (params.cfg as CoreConfig).channels ?? {};
  const gmail = channels.gmail ?? {};
  const accounts = gmail.accounts ?? {};
  if (accountKey === DEFAULT_ACCOUNT_ID && !accounts[accountKey]) {
    return {
      ...params.cfg,
      channels: { ...channels, gmail: { ...gmail, enabled: params.enabled } },
    } as OpenClawConfig;
  }
  return {
    ...params.cfg,
    channels: {
      ...channels,
      gmail: {
        ...gmail,
        accounts: {
          ...accounts,
          [accountKey]: { ...accounts[accountKey], enabled: params.enabled },
        },
      },
    },
  } as OpenClawConfig;
}

function deleteGmailAccount(params: { cfg: OpenClawConfig; accountId: string }): OpenClawConfig {
  const accountKey = params.accountId || DEFAULT_ACCOUNT_ID;
  const channels = (params.cfg as CoreConfig).channels ?? {};
  const gmail = channels.gmail ?? {};
  if (accountKey === DEFAULT_ACCOUNT_ID) {
    const { name, clientId, clientSecret, refreshToken, dmPolicy, allowFrom, ...rest } =
      gmail as Record<string, unknown>;
    return { ...params.cfg, channels: { ...channels, gmail: rest } } as OpenClawConfig;
  }
  const accounts = { ...gmail.accounts };
  delete accounts[accountKey];
  return {
    ...params.cfg,
    channels: { ...channels, gmail: { ...gmail, accounts } },
  } as OpenClawConfig;
}

const resolveGmailDmPolicy = createScopedDmSecurityResolver<ResolvedGmailAccount>({
  channelKey: "gmail",
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  defaultPolicy: "allowlist",
  normalizeEntry: (raw) => String(raw).trim().toLowerCase(),
});

export const gmailPlugin: ChannelPlugin<ResolvedGmailAccount, GmailProbe> = {
  id: "gmail",
  meta: { ...meta, quickstartAllowFrom: true },
  capabilities: { chatTypes: ["direct"], media: false },
  reload: { configPrefixes: ["channels.gmail"] },
  configSchema: buildChannelConfigSchema(GmailConfigSchema),

  config: {
    listAccountIds: (cfg) => listGmailAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveGmailAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultGmailAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setGmailAccountEnabled({ cfg, accountId, enabled }),
    deleteAccount: ({ cfg, accountId }) => deleteGmailAccount({ cfg, accountId }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      email: account.email || "(unknown — run probe to discover)",
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveGmailAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean),
  },

  security: {
    resolveDmPolicy: resolveGmailDmPolicy,
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if (!account.configured) {
        warnings.push(
          "Gmail credentials not configured (set clientId, clientSecret, refreshToken).",
        );
      }
      if (account.config.dmPolicy === "open" && !(account.config.allowFrom ?? []).includes("*")) {
        warnings.push('dmPolicy is "open" but allowFrom does not include "*".');
      }
      return warnings;
    },
  },

  messaging: {
    normalizeTarget: normalizeGmailTarget,
    targetResolver: {
      looksLikeId: looksLikeGmailTarget,
      hint: "<email@example.com>",
    },
  },

  resolver: {
    resolveTargets: async ({ inputs }) => {
      return inputs.map((input) => {
        const normalized = normalizeGmailTarget(input);
        if (!normalized) {
          return {
            input,
            resolved: false as const,
            note: "invalid email address",
          };
        }
        return {
          input,
          resolved: true as const,
          id: normalized,
          name: normalized,
        };
      });
    },
  },

  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveGmailAccount({ cfg: cfg as CoreConfig, accountId });
      const q = query?.trim().toLowerCase() ?? "";
      const ids = new Set<string>();
      for (const entry of account.config.allowFrom ?? []) {
        const normalized = String(entry).trim().toLowerCase();
        if (normalized && normalized !== "*") {
          ids.add(normalized);
        }
      }
      return Array.from(ids)
        .filter((id) => (q ? id.includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user" as const, id }));
    },
    listGroups: async () => [],
  },

  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getGmailRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "text",
    textChunkLimit: 50_000,
    sendText: async ({ to, text, accountId }) => {
      const result = await sendMessageGmail(to, text, {
        accountId: accountId ?? undefined,
        subject: "Message from OpenClaw",
      });
      return { channel: "gmail", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      const result = await sendMessageGmail(to, combined, {
        accountId: accountId ?? undefined,
        subject: "Message from OpenClaw",
      });
      return { channel: "gmail", ...result };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ account, snapshot }) => ({
      configured: snapshot.configured ?? false,
      email: account.email || "(unknown)",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => probeGmail(account),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      email: account.email,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(
          `Gmail is not configured for account "${account.accountId}" (need clientId, clientSecret, and refreshToken in channels.gmail).`,
        );
      }
      ctx.log?.info(`[gmail:${account.accountId}] starting Gmail provider`);

      const { stop } = await monitorGmailProvider({
        accountId: account.accountId,
        config: ctx.cfg as CoreConfig,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
        onMessage: async (message, resolvedAccount) => {
          await handleGmailInbound({
            message,
            account: resolvedAccount,
            config: ctx.cfg as CoreConfig,
          });
        },
      });

      return { stop };
    },
  },
};
