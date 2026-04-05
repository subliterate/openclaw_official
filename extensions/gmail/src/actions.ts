import type { OpenClawConfig } from "openclaw/plugin-sdk";

function createActionGate<T extends Record<string, boolean | undefined>>(
  actions: T | undefined,
): (key: string, defaultValue?: boolean) => boolean {
  return (key, defaultValue = true) => {
    const value = actions?.[key as keyof T];
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
  return { text: JSON.stringify(payload, null, 2), details: payload };
}
import { resolveGmailAccount } from "./accounts.js";
import { getMessage, listLabels, listMessages } from "./api.js";
import type { GmailConfig, ResolvedGmailAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { gmail?: GmailConfig };
};

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

// Actions are currently disabled: upstream ChannelMessageActionAdapter API
// changed from listActions/handleAction to describeMessageTool in v2026.4.
// These helper functions are preserved for future migration.

export async function gmailActionSearch(
  cfg: OpenClawConfig,
  params: Record<string, unknown>,
  accountId?: string,
) {
  const account = resolveGmailAccount({
    cfg: cfg as CoreConfig,
    accountId: accountId ?? undefined,
  });
  return handleSearch(account, params);
}

export async function gmailActionRead(
  cfg: OpenClawConfig,
  params: Record<string, unknown>,
  accountId?: string,
) {
  const account = resolveGmailAccount({
    cfg: cfg as CoreConfig,
    accountId: accountId ?? undefined,
  });
  return handleRead(account, params);
}

export async function gmailActionChannelList(cfg: OpenClawConfig, accountId?: string) {
  const account = resolveGmailAccount({
    cfg: cfg as CoreConfig,
    accountId: accountId ?? undefined,
  });
  return handleChannelList(account);
}

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
