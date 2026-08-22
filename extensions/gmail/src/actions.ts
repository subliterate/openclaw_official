import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { resolveGmailAccount } from "./accounts.js";
import { getMessage, listLabels, listMessages } from "./api.js";
import type { GmailConfig, ResolvedGmailAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { gmail?: GmailConfig };
};

// ── Inlined tool helpers (not in public plugin SDK) ─────────────────

function createActionGate(
  actions: Record<string, boolean | undefined> | undefined,
): (key: string, defaultValue?: boolean) => boolean {
  return (key, defaultValue = true) => {
    const value = actions?.[key];
    if (value === undefined) return defaultValue;
    return Boolean(value);
  };
}

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string } = {},
): string | undefined {
  const raw = params[key];
  if (raw == null || raw === "") {
    if (options.required) throw new Error(`${options.label ?? key} required`);
    return undefined;
  }
  return String(raw).trim();
}

function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { integer?: boolean } = {},
): number | undefined {
  const raw = params[key];
  if (raw == null || raw === "") return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return options.integer ? Math.floor(num) : num;
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

// ── Constants ───────────────────────────────────────────────────────

const SUPPORTED_ACTIONS = new Set<ChannelMessageActionName>(["search", "read", "channel-list"]);

const VISIBLE_SYSTEM_LABELS = new Set([
  "INBOX",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM",
  "STARRED",
  "IMPORTANT",
  "UNREAD",
]);

// ── Action adapter ──────────────────────────────────────────────────

export const gmailActions: ChannelMessageActionAdapter = {
  describeMessageTool: ({ cfg }) => {
    const account = resolveGmailAccount({ cfg: cfg as CoreConfig });
    if (!account.enabled || !account.configured) {
      return null;
    }
    const gate = createActionGate(
      (cfg as CoreConfig).channels?.gmail as unknown as Record<string, boolean | undefined>,
    );
    const actions: ChannelMessageActionName[] = [];
    if (gate("search")) actions.push("search");
    if (gate("read")) actions.push("read");
    if (gate("channel-list")) actions.push("channel-list");
    return { actions, visibility: "all-configured" };
  },

  supportsAction: ({ action }) => SUPPORTED_ACTIONS.has(action),

  extractToolSend: () => null,

  handleAction: async ({ action, params, cfg, accountId }) => {
    const account = resolveGmailAccount({
      cfg: cfg as CoreConfig,
      accountId: accountId ?? undefined,
    });

    if (action === "search") {
      return handleSearch(account, params);
    }
    if (action === "read") {
      return handleRead(account, params);
    }
    if (action === "channel-list") {
      return handleChannelList(account);
    }

    throw new Error(`Action "${action}" is not supported by the Gmail extension.`);
  },
};

// ── Action handlers ─────────────────────────────────────────────────

async function handleSearch(account: ResolvedGmailAccount, params: Record<string, unknown>) {
  const query = readStringParam(params, "query", { required: true, label: "Gmail search query" })!;
  const limit = readNumberParam(params, "limit", { integer: true }) ?? 10;

  const messages = await listMessages(account, { query, maxResults: limit });

  const results = await Promise.all(
    messages.slice(0, limit).map(async (stub) => {
      const msg = await getMessage(account, stub.id);
      return {
        id: msg.gmailMessageId,
        threadId: msg.threadId,
        from: msg.from,
        subject: msg.subject,
        snippet: msg.body.slice(0, 200),
        timestamp: msg.timestamp,
      };
    }),
  );

  return jsonResult({ ok: true, count: results.length, results });
}

async function handleRead(account: ResolvedGmailAccount, params: Record<string, unknown>) {
  const messageId = readStringParam(params, "messageId", {
    required: true,
    label: "Gmail message ID",
  })!;

  const msg = await getMessage(account, messageId);

  return jsonResult({
    ok: true,
    message: {
      id: msg.gmailMessageId,
      threadId: msg.threadId,
      from: msg.from,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      body: msg.body,
      timestamp: msg.timestamp,
      isReply: msg.isReply,
      attachments: msg.attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
    },
  });
}

async function handleChannelList(account: ResolvedGmailAccount) {
  const labels = await listLabels(account);

  const filtered = labels.filter((l) => l.type === "user" || VISIBLE_SYSTEM_LABELS.has(l.id));

  return jsonResult({
    ok: true,
    labels: filtered.map((l) => ({ id: l.id, name: l.name, type: l.type })),
  });
}
