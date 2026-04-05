import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveMessengerAccount } from "./accounts.js";
import { sendTextMessage } from "./api.js";
import { getMessengerRuntime } from "./runtime.js";
import type { MessengerConfig, MessengerSendResult, ResolvedMessengerAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { messenger?: MessengerConfig };
};

export type SendMessengerOptions = {
  accountId?: string;
};

export async function sendMessageMessenger(
  to: string,
  text: string,
  opts: SendMessengerOptions = {},
): Promise<MessengerSendResult> {
  const runtime = getMessengerRuntime();
  const cfg = runtime.config.loadConfig() as CoreConfig;
  const account = resolveMessengerAccount({ cfg, accountId: opts.accountId });

  if (!account.configured) {
    throw new Error(
      `Messenger is not configured for account "${account.accountId}" (need pageAccessToken, appSecret, and verifyToken in channels.messenger).`,
    );
  }

  const body = text.trim();
  if (!body) {
    throw new Error("Message must be non-empty for Messenger sends");
  }

  const result = await sendTextMessage(account, to, body);

  runtime.channel.activity.record({
    channel: "messenger",
    accountId: account.accountId,
    direction: "outbound",
  });

  return result;
}

/**
 * Resolve account for outbound sends.
 */
export function resolveMessengerAccountForSend(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedMessengerAccount {
  return resolveMessengerAccount(params);
}
