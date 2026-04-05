import { getAccessToken } from "./auth.js";
import type {
  GmailAttachment,
  GmailInboundMessage,
  GmailProbe,
  GmailSendResult,
  ResolvedGmailAccount,
} from "./types.js";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gmailFetch(
  account: ResolvedGmailAccount,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken(account);
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  return res;
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function encodeBase64Url(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64url");
}

function extractHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string {
  if (!headers) {
    return "";
  }
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] ?? raw).trim().toLowerCase();
}

function extractAddressList(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw.split(",").map((addr) => extractEmailAddress(addr));
}

function extractBody(payload: GmailMessagePayload): { text: string; html: string } {
  let text = "";
  let html = "";

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") {
      text = decoded;
    } else if (payload.mimeType === "text/html") {
      html = decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data && !text) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data && !html) {
        html = decodeBase64Url(part.body.data);
      } else if (part.mimeType?.startsWith("multipart/") && part.parts) {
        const nested = extractBody(part);
        if (!text && nested.text) {
          text = nested.text;
        }
        if (!html && nested.html) {
          html = nested.html;
        }
      }
    }
  }

  return { text, html };
}

function extractAttachments(payload: GmailMessagePayload): GmailAttachment[] {
  const attachments: GmailAttachment[] = [];

  function walk(part: GmailMessagePayload) {
    if (part.body?.attachmentId && part.filename) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);
  return attachments;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Gmail API types (partial)
// ---------------------------------------------------------------------------

type GmailMessagePayload = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePayload[];
};

type GmailMessageResource = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePayload;
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailHistoryResponse = {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
};

type GmailProfileResponse = {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the authenticated user's email address and current historyId.
 */
export async function getProfile(
  account: ResolvedGmailAccount,
): Promise<{ email: string; historyId: string }> {
  const res = await gmailFetch(account, "/profile");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail profile fetch failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as GmailProfileResponse;
  return {
    email: json.emailAddress,
    historyId: json.historyId ?? "",
  };
}

/**
 * Probe the Gmail account to verify credentials and connectivity.
 */
export async function probeGmail(account: ResolvedGmailAccount): Promise<GmailProbe> {
  const start = Date.now();
  try {
    const profile = await getProfile(account);
    return {
      ok: true,
      email: profile.email,
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
 * Get a single message by ID with full payload.
 */
export async function getMessage(
  account: ResolvedGmailAccount,
  messageId: string,
): Promise<GmailInboundMessage> {
  const res = await gmailFetch(account, `/messages/${messageId}?format=full`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail message fetch failed (${res.status}): ${text}`);
  }
  const msg = (await res.json()) as GmailMessageResource;
  return parseGmailMessage(msg);
}

/**
 * List recent messages matching a query.
 */
export async function listMessages(
  account: ResolvedGmailAccount,
  opts?: { query?: string; maxResults?: number; label?: string },
): Promise<Array<{ id: string; threadId: string }>> {
  const params = new URLSearchParams();
  if (opts?.query) {
    params.set("q", opts.query);
  }
  if (opts?.label) {
    params.set("labelIds", opts.label);
  }
  params.set("maxResults", String(opts?.maxResults ?? 10));

  const res = await gmailFetch(account, `/messages?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail list messages failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as GmailListResponse;
  return json.messages ?? [];
}

/**
 * List Gmail labels for the authenticated user.
 */
export async function listLabels(
  account: ResolvedGmailAccount,
): Promise<Array<{ id: string; name: string; type: string }>> {
  const res = await gmailFetch(account, "/labels");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail list labels failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { labels?: Array<{ id: string; name: string; type: string }> };
  return (json.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type }));
}

/**
 * List Gmail threads matching an optional query.
 */
export async function listThreads(
  account: ResolvedGmailAccount,
  opts?: { query?: string; maxResults?: number },
): Promise<Array<{ id: string; snippet: string; historyId: string }>> {
  const params = new URLSearchParams();
  if (opts?.query) {
    params.set("q", opts.query);
  }
  params.set("maxResults", String(opts?.maxResults ?? 10));

  const res = await gmailFetch(account, `/threads?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail list threads failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    threads?: Array<{ id: string; snippet?: string; historyId?: string }>;
  };
  return (json.threads ?? []).map((t) => ({
    id: t.id,
    snippet: t.snippet ?? "",
    historyId: t.historyId ?? "",
  }));
}

/**
 * Poll for new messages since a given historyId.
 * Returns new message IDs added to INBOX since the given historyId.
 */
export async function pollHistory(
  account: ResolvedGmailAccount,
  startHistoryId: string,
  label?: string,
): Promise<{ messageIds: string[]; latestHistoryId: string }> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
  });
  if (label) {
    params.set("labelId", label);
  }

  const res = await gmailFetch(account, `/history?${params.toString()}`);
  if (!res.ok) {
    // 404 means historyId is too old; caller should do a full sync.
    if (res.status === 404) {
      return { messageIds: [], latestHistoryId: "" };
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail history poll failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as GmailHistoryResponse;
  const messageIds = new Set<string>();
  for (const entry of json.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      const targetLabel = label ?? "INBOX";
      if (added.message.labelIds?.includes(targetLabel)) {
        messageIds.add(added.message.id);
      }
    }
  }

  return {
    messageIds: [...messageIds],
    latestHistoryId: json.historyId ?? startHistoryId,
  };
}

/**
 * Send an email via Gmail API.
 */
export async function sendEmail(
  account: ResolvedGmailAccount,
  params: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
  },
): Promise<GmailSendResult> {
  const fromEmail = account.email || (await getProfile(account)).email;
  const headers = [
    `From: ${fromEmail}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];

  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references) {
    headers.push(`References: ${params.references}`);
  }

  const raw = encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${params.body}`);

  const requestBody: Record<string, string> = { raw };
  if (params.threadId) {
    requestBody.threadId = params.threadId;
  }

  const res = await gmailFetch(account, "/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail send failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { id: string; threadId: string };
  return {
    messageId: json.id,
    threadId: json.threadId,
    target: params.to,
  };
}

/**
 * Parse a Gmail API message resource into an inbound message.
 */
export function parseGmailMessage(msg: GmailMessageResource): GmailInboundMessage {
  const headers = msg.payload?.headers;
  const from = extractEmailAddress(extractHeader(headers, "From"));
  const to = extractAddressList(extractHeader(headers, "To"));
  const cc = extractAddressList(extractHeader(headers, "Cc"));
  const subject = extractHeader(headers, "Subject");
  const messageIdHeader = extractHeader(headers, "Message-ID");
  const inReplyTo = extractHeader(headers, "In-Reply-To") || undefined;

  const { text, html } = extractBody(msg.payload ?? {});
  const body = text || stripHtmlTags(html);
  const attachments = msg.payload ? extractAttachments(msg.payload) : [];

  return {
    messageId: messageIdHeader || msg.id,
    gmailMessageId: msg.id,
    threadId: msg.threadId,
    from,
    to,
    cc,
    subject,
    body,
    timestamp: msg.internalDate ? Number(msg.internalDate) : Date.now(),
    isReply: Boolean(inReplyTo),
    inReplyTo,
    attachments,
  };
}
