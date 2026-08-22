export type MessengerAccountConfig = {
  name?: string;
  enabled?: boolean;
  /** Facebook Page access token. */
  pageAccessToken?: string;
  /** Facebook App secret (used for webhook signature verification). */
  appSecret?: string;
  /** Webhook verify token (shared secret for GET verification). */
  verifyToken?: string;
  /** Webhook path on the gateway HTTP server (e.g. "/webhook/messenger"). */
  webhookPath?: string;
  /** DM policy for incoming messages. */
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  /** PSID allowlist (Page-Scoped User IDs permitted to trigger inbound messages). */
  allowFrom?: Array<string | number>;
  /** Text chunk limit for outbound messages (default: 2000). */
  textChunkLimit?: number;
  /** Maximum attachment size in MB (default: 25). */
  mediaMaxMb?: number;
};

export type MessengerConfig = MessengerAccountConfig & {
  accounts?: Record<string, MessengerAccountConfig>;
};

export type ResolvedMessengerAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  pageAccessToken: string;
  appSecret: string;
  verifyToken: string;
  webhookPath: string;
  config: MessengerAccountConfig;
};

export type MessengerProbe = {
  ok: boolean;
  pageId?: string;
  pageName?: string;
  latencyMs?: number;
  error?: string;
};

export type MessengerSendResult = {
  recipientId: string;
  messageId: string;
};

export type MessengerInboundMessage = {
  senderId: string;
  recipientId: string;
  timestamp: number;
  messageId: string;
  text: string;
  attachments?: MessengerAttachment[];
};

export type MessengerAttachment = {
  type: "image" | "video" | "audio" | "file" | "fallback";
  url?: string;
};
