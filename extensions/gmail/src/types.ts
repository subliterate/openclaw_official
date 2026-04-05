export type GmailAccountConfig = {
  name?: string;
  enabled?: boolean;
  /** OAuth client ID (from Google Cloud Console). */
  clientId?: string;
  /** OAuth client secret. */
  clientSecret?: string;
  /** OAuth refresh token (obtained after initial authorization). */
  refreshToken?: string;
  /** DM policy for incoming emails. */
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  /** Email allowlist (addresses permitted to trigger inbound messages). */
  allowFrom?: Array<string | number>;
  /** Polling interval in seconds (default: 60). */
  pollIntervalSec?: number;
  /** Maximum emails to fetch per poll cycle (default: 10). */
  maxResults?: number;
  /** Gmail label to monitor for inbound (default: "INBOX"). */
  label?: string;
  /** Gmail query filter for inbound polling (e.g. "is:unread"). */
  query?: string;
  /** Text chunk limit for outbound messages (default: 50000). */
  textChunkLimit?: number;
  /** Maximum attachment size in MB (default: 25). */
  mediaMaxMb?: number;
};

export type GmailConfig = GmailAccountConfig & {
  accounts?: Record<string, GmailAccountConfig>;
};

export type ResolvedGmailAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  email: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  config: GmailAccountConfig;
};

export type GmailTokens = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
};

export type GmailInboundMessage = {
  messageId: string;
  gmailMessageId: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  timestamp: number;
  isReply: boolean;
  inReplyTo?: string;
  attachments: GmailAttachment[];
};

export type GmailAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
};

export type GmailProbe = {
  ok: boolean;
  email?: string;
  latencyMs?: number;
  error?: string;
};

export type GmailSendResult = {
  messageId: string;
  threadId?: string;
  target: string;
};
