import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { MessengerWebhookBody } from "./api.js";
import { parseMessengerMessage } from "./api.js";
import { handleMessengerInbound } from "./inbound.js";
import { getMessengerRuntime } from "./runtime.js";
import type { ResolvedMessengerAccount } from "./types.js";

type MessengerWebhookTarget = {
  account: ResolvedMessengerAccount;
  config: OpenClawConfig;
  path: string;
};

const webhookTargets = new Map<string, MessengerWebhookTarget[]>();

function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "/";
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

export function registerMessengerWebhookTarget(target: MessengerWebhookTarget): () => void {
  const key = normalizeWebhookPath(target.path);
  const normalizedTarget = { ...target, path: key };
  const existing = webhookTargets.get(key) ?? [];
  const next = [...existing, normalizedTarget];
  webhookTargets.set(key, next);
  return () => {
    const updated = (webhookTargets.get(key) ?? []).filter((entry) => entry !== normalizedTarget);
    if (updated.length > 0) {
      webhookTargets.set(key, updated);
    } else {
      webhookTargets.delete(key);
    }
  };
}

/**
 * Verify the X-Hub-Signature-256 header against the request body.
 */
function verifySignature(appSecret: string, rawBody: Buffer, signature: string): boolean {
  if (!signature.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signature.slice(7);
  if (expected.length !== received.length) {
    return false;
  }
  // Constant-time comparison.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Read the raw body of the request as a Buffer (for signature verification).
 */
function readRawBody(req: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("request body timeout"));
    }, timeoutMs);

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        clearTimeout(timer);
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Main HTTP handler registered with the plugin system.
 * Handles both GET (webhook verification) and POST (event delivery).
 */
export async function handleMessengerWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = normalizeWebhookPath(url.pathname);
  const targets = webhookTargets.get(path);
  if (!targets || targets.length === 0) {
    return false;
  }

  // --- GET: Webhook verification challenge ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token || !challenge) {
      res.statusCode = 400;
      res.end("Bad Request");
      return true;
    }

    const target = targets.find((t) => t.account.verifyToken === token);
    if (!target) {
      res.statusCode = 403;
      res.end("Forbidden");
      return true;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end(challenge);
    return true;
  }

  // --- POST: Event delivery ---
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end("Method Not Allowed");
    return true;
  }

  const signature = String(req.headers["x-hub-signature-256"] ?? "");

  // Read raw body for signature verification.
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req, 1024 * 1024, 30_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "payload too large") {
      res.statusCode = 413;
      res.end("Payload Too Large");
    } else {
      res.statusCode = 408;
      res.end("Request Timeout");
    }
    return true;
  }

  // Find target whose appSecret validates the signature.
  const target = targets.find((t) => verifySignature(t.account.appSecret, rawBody, signature));
  if (!target) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return true;
  }

  // Parse JSON body.
  let body: MessengerWebhookBody;
  try {
    body = JSON.parse(rawBody.toString("utf-8")) as MessengerWebhookBody;
  } catch {
    res.statusCode = 400;
    res.end("Invalid JSON");
    return true;
  }

  // Must respond 200 quickly to avoid retries.
  res.statusCode = 200;
  res.end("EVENT_RECEIVED");

  // Process messages asynchronously.
  const core = getMessengerRuntime();
  const logger = core.logging.getChildLogger({ channel: "messenger" });
  if (body.object === "page" && body.entry) {
    for (const entry of body.entry) {
      for (const messaging of entry.messaging ?? []) {
        const message = parseMessengerMessage(messaging);
        if (!message || !message.text.trim()) {
          continue;
        }

        handleMessengerInbound({
          message,
          account: target.account,
          config: target.config,
        }).catch((err) => {
          logger.error(
            `[messenger:${target.account.accountId}] inbound processing failed: ${String(err)}`,
          );
        });
      }
    }
  }

  return true;
}
