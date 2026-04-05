import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { sendEmail } from "./api.js";
import { getGmailRuntime } from "./runtime.js";
import type { GmailConfig, GmailInboundMessage, ResolvedGmailAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { gmail?: GmailConfig };
};

function normalizeGmailAllowEntry(raw: string): string {
  return String(raw).trim().toLowerCase();
}

function isAllowedSender(from: string, allowFrom: Array<string | number>): boolean {
  const normalized = from.trim().toLowerCase();
  for (const entry of allowFrom) {
    const rule = normalizeGmailAllowEntry(String(entry));
    if (rule === "*") {
      return true;
    }
    if (rule === normalized) {
      return true;
    }
    // Support domain wildcards like "*@example.com".
    if (rule.startsWith("*@")) {
      const domain = rule.slice(2);
      if (normalized.endsWith(`@${domain}`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Handle an inbound Gmail message: apply DM policy, then route to agent.
 */
export async function handleGmailInbound(params: {
  message: GmailInboundMessage;
  account: ResolvedGmailAccount;
  config: CoreConfig;
}): Promise<void> {
  const { message, account, config } = params;
  const core = getGmailRuntime();

  const logger = core.logging.getChildLogger({ channel: "gmail", accountId: account.accountId });
  const body = message.body.trim();
  if (!body) {
    return;
  }

  // DM policy enforcement.
  const dmPolicy = account.config.dmPolicy ?? "allowlist";
  if (dmPolicy === "disabled") {
    logger.info(
      `[policy-denial] channel="gmail" account="${account.accountId}" from="${message.from}" dmPolicy="disabled" — inbound dropped`,
    );
    return;
  }

  const allowFrom = account.config.allowFrom ?? [];

  if (dmPolicy !== "open") {
    if (!isAllowedSender(message.from, allowFrom)) {
      logger.warn(
        `[policy-denial] channel="gmail" account="${account.accountId}" from="${message.from}" dmPolicy="${dmPolicy}" — inbound blocked by DM policy`,
      );
      if (dmPolicy === "pairing") {
        logger.info(
          `[gmail:${account.accountId}] pairing request from ${message.from} (not in allowlist)`,
        );
        // Could send a pairing request email here in the future.
      }
      return;
    }
  }

  // Build display text: include subject for new threads, body only for replies.
  const displayText = message.isReply
    ? body
    : message.subject
      ? `**${message.subject}**\n\n${body}`
      : body;

  // Route to agent.
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: "gmail",
    accountId: account.accountId,
    peer: {
      kind: "direct",
      id: message.from,
    },
  });

  const ctxPayload = {
    Body: displayText,
    BodyForAgent: displayText,
    From: `gmail:${message.from}`,
    To: `gmail:${account.accountId}`,
    SessionKey: route.sessionKey,
    AccountId: account.accountId,
    ChatType: "direct" as const,
    Provider: "gmail" as const,
    Surface: "gmail" as const,
    OriginatingChannel: "gmail" as const,
    OriginatingTo: `gmail:${account.accountId}`,
    SenderName: message.from,
    SenderId: message.from,
    MessageSid: message.gmailMessageId,
    Timestamp: message.timestamp,
    GroupSubject: message.subject || undefined,
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

        await sendEmail(account, {
          to: message.from,
          subject: `Re: ${message.subject}`,
          body: replyText,
          inReplyTo: message.messageId,
          references: message.messageId,
          threadId: message.threadId,
        });

        core.channel.activity.record({
          channel: "gmail",
          accountId: account.accountId,
          direction: "outbound",
        });
      },
      onError: (err) => {
        logger.error(
          `[gmail:${account.accountId}] reply to ${message.from} failed: ${String(err)}`,
        );
      },
    },
  });
}
