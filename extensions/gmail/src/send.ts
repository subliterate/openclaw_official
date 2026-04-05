import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveGmailAccount } from "./accounts.js";
import { sendEmail } from "./api.js";
import { getGmailRuntime } from "./runtime.js";
import type { GmailConfig, GmailSendResult, ResolvedGmailAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { gmail?: GmailConfig };
};

export type SendGmailOptions = {
  accountId?: string;
  subject?: string;
  replyTo?: string;
  threadId?: string;
};

export async function sendMessageGmail(
  to: string,
  text: string,
  opts: SendGmailOptions = {},
): Promise<GmailSendResult> {
  const runtime = getGmailRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const account = resolveGmailAccount({ cfg, accountId: opts.accountId });

  if (!account.configured) {
    throw new Error(
      `Gmail is not configured for account "${account.accountId}" (need clientId, clientSecret, and refreshToken in channels.gmail).`,
    );
  }

  const subject = opts.subject?.trim() || "(no subject)";
  const body = text.trim();
  if (!body) {
    throw new Error("Message must be non-empty for Gmail sends");
  }

  const result = await sendEmail(account, {
    to,
    subject,
    body,
    inReplyTo: opts.replyTo,
    threadId: opts.threadId,
  });

  runtime.channel.activity.record({
    channel: "gmail",
    accountId: account.accountId,
    direction: "outbound",
  });

  return result;
}

/**
 * Resolve account for outbound sends.
 */
export function resolveGmailAccountForSend(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedGmailAccount {
  return resolveGmailAccount(params);
}
