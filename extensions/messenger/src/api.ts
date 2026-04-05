import type {
  MessengerInboundMessage,
  MessengerProbe,
  MessengerSendResult,
  ResolvedMessengerAccount,
} from "./types.js";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function messengerFetch(
  account: ResolvedMessengerAccount,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${GRAPH_API_BASE}${path}`;
  const separator = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${separator}access_token=${account.pageAccessToken}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  return res;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe the Messenger account by fetching the Page profile.
 */
export async function probeMessenger(account: ResolvedMessengerAccount): Promise<MessengerProbe> {
  const start = Date.now();
  try {
    const res = await messengerFetch(account, "/me?fields=id,name");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Messenger page fetch failed (${res.status}): ${text}`,
        latencyMs: Date.now() - start,
      };
    }
    const json = (await res.json()) as { id: string; name: string };
    return {
      ok: true,
      pageId: json.id,
      pageName: json.name,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Send a text message via the Messenger Send API.
 */
export async function sendTextMessage(
  account: ResolvedMessengerAccount,
  recipientId: string,
  text: string,
): Promise<MessengerSendResult> {
  const res = await messengerFetch(account, "/me/messages", {
    method: "POST",
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: "RESPONSE",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Messenger send failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { recipient_id: string; message_id: string };
  return {
    recipientId: json.recipient_id,
    messageId: json.message_id,
  };
}

/**
 * Send a media attachment via the Messenger Send API.
 */
export async function sendMediaMessage(
  account: ResolvedMessengerAccount,
  recipientId: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" | "file",
  text?: string,
): Promise<MessengerSendResult> {
  // Send attachment first.
  const attachmentRes = await messengerFetch(account, "/me/messages", {
    method: "POST",
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: mediaType,
          payload: { url: mediaUrl, is_reusable: false },
        },
      },
      messaging_type: "RESPONSE",
    }),
  });

  if (!attachmentRes.ok) {
    const body = await attachmentRes.text().catch(() => "");
    throw new Error(`Messenger media send failed (${attachmentRes.status}): ${body}`);
  }

  const json = (await attachmentRes.json()) as {
    recipient_id: string;
    message_id: string;
  };

  // If there's accompanying text, send it as a separate message.
  if (text?.trim()) {
    await sendTextMessage(account, recipientId, text);
  }

  return {
    recipientId: json.recipient_id,
    messageId: json.message_id,
  };
}

/**
 * Parse a Messenger webhook messaging entry into an inbound message.
 */
export function parseMessengerMessage(
  entry: MessengerWebhookMessaging,
): MessengerInboundMessage | null {
  if (!entry.message) {
    return null;
  }

  const attachments = entry.message.attachments?.map((a) => ({
    type: a.type as MessengerInboundMessage["attachments"] extends (infer T)[] | undefined
      ? T extends { type: infer U }
        ? U
        : never
      : never,
    url: a.payload?.url,
  }));

  return {
    senderId: entry.sender.id,
    recipientId: entry.recipient.id,
    timestamp: entry.timestamp,
    messageId: entry.message.mid,
    text: entry.message.text ?? "",
    attachments: attachments as MessengerInboundMessage["attachments"],
  };
}

// ---------------------------------------------------------------------------
// Webhook payload types
// ---------------------------------------------------------------------------

export type MessengerWebhookBody = {
  object: string;
  entry?: Array<{
    id: string;
    time: number;
    messaging?: MessengerWebhookMessaging[];
  }>;
};

export type MessengerWebhookMessaging = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload?: { url?: string };
    }>;
  };
  postback?: {
    title: string;
    payload: string;
  };
};
