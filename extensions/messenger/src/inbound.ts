import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { sendTextMessage } from "./api.js";
import { getMessengerRuntime } from "./runtime.js";
import type {
  MessengerConfig,
  MessengerInboundMessage,
  ResolvedMessengerAccount,
} from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { messenger?: MessengerConfig };
};

function normalizeAllowEntry(raw: string): string {
  return String(raw).trim().toLowerCase();
}

function isAllowedSender(senderId: string, allowFrom: Array<string | number>): boolean {
  const normalized = senderId.trim().toLowerCase();
  for (const entry of allowFrom) {
    const rule = normalizeAllowEntry(String(entry));
    if (rule === "*") {
      return true;
    }
    if (rule === normalized) {
      return true;
    }
    // Strip messenger:/fb:/psid: prefixes for comparison.
    for (const prefix of ["messenger:", "fb:", "psid:"]) {
      if (rule.startsWith(prefix) && rule.slice(prefix.length) === normalized) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Handle an inbound Messenger message: apply DM policy, then route to agent.
 */
export async function handleMessengerInbound(params: {
  message: MessengerInboundMessage;
  account: ResolvedMessengerAccount;
  config: CoreConfig;
}): Promise<void> {
  const { message, account, config } = params;
  const core = getMessengerRuntime();
  const logger = core.logging.getChildLogger({
    channel: "messenger",
    accountId: account.accountId,
  });

  const body = message.text.trim();
  if (!body) {
    return;
  }

  // DM policy enforcement.
  const dmPolicy = account.config.dmPolicy ?? "allowlist";
  if (dmPolicy === "disabled") {
    logger.info(
      `[policy-denial] channel="messenger" account="${account.accountId}" from="${message.senderId}" dmPolicy="disabled" — inbound dropped`,
    );
    return;
  }

  const allowFrom = account.config.allowFrom ?? [];

  if (dmPolicy !== "open") {
    if (!isAllowedSender(message.senderId, allowFrom)) {
      logger.warn(
        `[policy-denial] channel="messenger" account="${account.accountId}" from="${message.senderId}" dmPolicy="${dmPolicy}" — inbound blocked by DM policy`,
      );
      if (dmPolicy === "pairing") {
        logger.info(
          `[messenger:${account.accountId}] pairing request from ${message.senderId} (not in allowlist)`,
        );
      }
      return;
    }
  }

  // Route to agent.
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: "messenger",
    accountId: account.accountId,
    peer: {
      kind: "direct",
      id: message.senderId,
    },
  });

  const ctxPayload = {
    Body: body,
    BodyForAgent: body,
    From: `messenger:${message.senderId}`,
    To: `messenger:${account.accountId}`,
    SessionKey: route.sessionKey,
    AccountId: account.accountId,
    ChatType: "direct" as const,
    Provider: "messenger" as const,
    Surface: "messenger" as const,
    OriginatingChannel: "messenger" as const,
    OriginatingTo: `messenger:${account.accountId}`,
    SenderName: message.senderId,
    SenderId: message.senderId,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
  };

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config as OpenClawConfig,
    dispatcherOptions: {
      deliver: async (payload) => {
        const replyText =
          typeof payload === "string"
            ? payload
            : typeof payload === "object" && payload && "text" in payload
              ? String((payload as { text: unknown }).text)
              : String(payload);

        if (!replyText.trim()) {
          return;
        }

        await sendTextMessage(account, message.senderId, replyText);

        core.channel.activity.record({
          channel: "messenger",
          accountId: account.accountId,
          direction: "outbound",
        });
      },
      onError: (err) => {
        logger.error(
          `[messenger:${account.accountId}] reply to ${message.senderId} failed: ${String(err)}`,
        );
      },
    },
  });
}
