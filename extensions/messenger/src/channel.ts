import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { createScopedDmSecurityResolver } from "openclaw/plugin-sdk/channel-config-helpers";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import {
  listMessengerAccountIds,
  resolveDefaultMessengerAccountId,
  resolveMessengerAccount,
} from "./accounts.js";
import { probeMessenger } from "./api.js";
import { MessengerConfigSchema } from "./config-schema.js";
import { handleMessengerInbound } from "./inbound.js";
import { looksLikeMessengerTarget, normalizeMessengerTarget } from "./normalize.js";
import { getMessengerRuntime } from "./runtime.js";
import { sendMessageMessenger } from "./send.js";
import type { MessengerConfig, MessengerProbe, ResolvedMessengerAccount } from "./types.js";
import { registerMessengerWebhookTarget } from "./webhook.js";

type CoreConfig = OpenClawConfig & {
  channels?: { messenger?: MessengerConfig };
};

const DEFAULT_ACCOUNT_ID = "default";

function setMessengerAccountEnabled(params: {
  cfg: OpenClawConfig;
  accountId: string;
  enabled: boolean;
}): OpenClawConfig {
  const accountKey = params.accountId || DEFAULT_ACCOUNT_ID;
  const channels = (params.cfg as CoreConfig).channels ?? {};
  const messenger = channels.messenger ?? {};
  const accounts = messenger.accounts ?? {};
  if (accountKey === DEFAULT_ACCOUNT_ID && !accounts[accountKey]) {
    return {
      ...params.cfg,
      channels: { ...channels, messenger: { ...messenger, enabled: params.enabled } },
    } as OpenClawConfig;
  }
  return {
    ...params.cfg,
    channels: {
      ...channels,
      messenger: {
        ...messenger,
        accounts: {
          ...accounts,
          [accountKey]: { ...accounts[accountKey], enabled: params.enabled },
        },
      },
    },
  } as OpenClawConfig;
}

function deleteMessengerAccount(params: {
  cfg: OpenClawConfig;
  accountId: string;
}): OpenClawConfig {
  const accountKey = params.accountId || DEFAULT_ACCOUNT_ID;
  const channels = (params.cfg as CoreConfig).channels ?? {};
  const messenger = channels.messenger ?? {};
  if (accountKey === DEFAULT_ACCOUNT_ID) {
    const {
      name,
      pageAccessToken,
      appSecret,
      verifyToken,
      webhookPath,
      dmPolicy,
      allowFrom,
      ...rest
    } = messenger as Record<string, unknown>;
    return { ...params.cfg, channels: { ...channels, messenger: rest } } as OpenClawConfig;
  }
  const accounts = { ...messenger.accounts };
  delete accounts[accountKey];
  return {
    ...params.cfg,
    channels: { ...channels, messenger: { ...messenger, accounts } },
  } as OpenClawConfig;
}

const resolveMessengerDmPolicy = createScopedDmSecurityResolver<ResolvedMessengerAccount>({
  channelKey: "messenger",
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  defaultPolicy: "allowlist",
  normalizeEntry: (raw) => String(raw).trim().toLowerCase(),
});

const meta = {
  id: "messenger" as const,
  label: "Messenger",
  selectionLabel: "Facebook Messenger",
  docsPath: "/channels/messenger",
  blurb: "Send and receive messages via Facebook Messenger.",
};

export const messengerPlugin: ChannelPlugin<ResolvedMessengerAccount, MessengerProbe> = {
  id: "messenger",
  meta: { ...meta, quickstartAllowFrom: true },
  capabilities: { chatTypes: ["direct"], media: true },
  reload: { configPrefixes: ["channels.messenger"] },
  configSchema: buildChannelConfigSchema(MessengerConfigSchema),

  config: {
    listAccountIds: (cfg) => listMessengerAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveMessengerAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultMessengerAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setMessengerAccountEnabled({ cfg, accountId, enabled }),
    deleteAccount: ({ cfg, accountId }) => deleteMessengerAccount({ cfg, accountId }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      webhookPath: account.webhookPath,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveMessengerAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean),
  },

  security: {
    resolveDmPolicy: resolveMessengerDmPolicy,
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];
      if (!account.configured) {
        warnings.push(
          "Messenger credentials not configured (set pageAccessToken, appSecret, verifyToken).",
        );
      }
      if (account.config.dmPolicy === "open" && !(account.config.allowFrom ?? []).includes("*")) {
        warnings.push('dmPolicy is "open" but allowFrom does not include "*".');
      }
      return warnings;
    },
  },

  messaging: {
    normalizeTarget: normalizeMessengerTarget,
    targetResolver: {
      looksLikeId: looksLikeMessengerTarget,
      hint: "<PSID>",
    },
  },

  resolver: {
    resolveTargets: async ({ inputs }) => {
      return inputs.map((input) => {
        const normalized = normalizeMessengerTarget(input);
        if (!normalized) {
          return {
            input,
            resolved: false as const,
            note: "invalid Messenger PSID",
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
      const account = resolveMessengerAccount({ cfg: cfg as CoreConfig, accountId });
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
    chunker: (text, limit) => getMessengerRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "text",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId }) => {
      const result = await sendMessageMessenger(to, text, {
        accountId: accountId ?? undefined,
      });
      return { channel: "messenger", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      // Append media URL as text reference (Messenger handles inline via Send API but
      // the simple outbound path just appends).
      const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      const result = await sendMessageMessenger(to, combined, {
        accountId: accountId ?? undefined,
      });
      return { channel: "messenger", ...result };
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
      webhookPath: account.webhookPath || "(default)",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => probeMessenger(account),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      webhookPath: account.webhookPath,
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
          `Messenger is not configured for account "${account.accountId}" (need pageAccessToken, appSecret, and verifyToken in channels.messenger).`,
        );
      }
      ctx.log?.info(
        `[messenger:${account.accountId}] starting Messenger provider (webhook: ${account.webhookPath})`,
      );

      const unregister = registerMessengerWebhookTarget({
        account,
        config: ctx.cfg as CoreConfig,
        path: account.webhookPath,
      });

      ctx.setStatus({
        accountId: ctx.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      return {
        stop: () => {
          unregister();
          ctx.setStatus({
            accountId: ctx.accountId,
            running: false,
            lastStopAt: Date.now(),
          });
          ctx.log?.info(`[messenger:${account.accountId}] Messenger provider stopped`);
        },
      };
    },
  },
};
