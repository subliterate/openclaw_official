import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { handleMessengerWebhookRequest, registerMessengerWebhookTarget } from "./webhook.js";

// Mock the runtime module.
vi.mock("./runtime.js", () => ({
  getMessengerRuntime: () => ({
    logging: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    channel: {
      activity: { record: vi.fn() },
    },
  }),
}));

// Mock the inbound handler.
vi.mock("./inbound.js", () => ({
  handleMessengerInbound: vi.fn().mockResolvedValue(undefined),
}));

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = {
    method,
    url,
    headers: { ...headers },
    on: vi.fn(),
    destroy: vi.fn(),
  } as unknown as IncomingMessage;
  return req;
}

function makeRes(): ServerResponse & { _body: string; _headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    _body: "",
    _headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res._headers[name] = value;
    },
    end(body?: string) {
      res._body = body ?? "";
    },
  } as unknown as ServerResponse & { _body: string; _headers: Record<string, string> };
  return res;
}

const mockAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  pageAccessToken: "test-page-token",
  appSecret: "test-app-secret",
  verifyToken: "test-verify-token",
  webhookPath: "/webhook/messenger",
  config: {},
};

describe("handleMessengerWebhookRequest", () => {
  let unregister: () => void;

  beforeEach(() => {
    unregister = registerMessengerWebhookTarget({
      account: mockAccount as any,
      config: {} as any,
      path: "/webhook/messenger",
    });
  });

  afterEach(() => {
    unregister?.();
  });

  it("returns false for unregistered paths", async () => {
    const req = makeReq("GET", "/unrelated");
    const res = makeRes();
    const handled = await handleMessengerWebhookRequest(req, res);
    expect(handled).toBe(false);
  });

  it("handles GET verification challenge", async () => {
    const req = makeReq(
      "GET",
      "/webhook/messenger?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE_123",
    );
    const res = makeRes();
    const handled = await handleMessengerWebhookRequest(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res._body).toBe("CHALLENGE_123");
  });

  it("rejects GET with wrong verify token", async () => {
    const req = makeReq(
      "GET",
      "/webhook/messenger?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=CHALLENGE",
    );
    const res = makeRes();
    const handled = await handleMessengerWebhookRequest(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it("rejects GET with missing hub.mode", async () => {
    const req = makeReq(
      "GET",
      "/webhook/messenger?hub.verify_token=test-verify-token&hub.challenge=CHALLENGE",
    );
    const res = makeRes();
    const handled = await handleMessengerWebhookRequest(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-GET/POST methods", async () => {
    const req = makeReq("PUT", "/webhook/messenger");
    const res = makeRes();
    const handled = await handleMessengerWebhookRequest(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(405);
  });

  it("rejects POST with invalid signature", async () => {
    const payload = JSON.stringify({ object: "page", entry: [] });
    const rawBody = Buffer.from(payload);

    const req = makeReq("POST", "/webhook/messenger", {
      "x-hub-signature-256": "sha256=invalidsignature",
    });

    // Simulate request body reading.
    (req as any).on = vi.fn((event: string, handler: Function) => {
      if (event === "data") {
        handler(rawBody);
      }
      if (event === "end") {
        handler();
      }
      return req;
    });

    const res = makeRes();
    const handled = await handleMessengerWebhookRequest(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
  });

  it("accepts POST with valid signature and responds 200", async () => {
    const payload = JSON.stringify({ object: "page", entry: [] });
    const rawBody = Buffer.from(payload);
    const signature =
      "sha256=" + createHmac("sha256", "test-app-secret").update(rawBody).digest("hex");

    const req = makeReq("POST", "/webhook/messenger", {
      "x-hub-signature-256": signature,
    });

    (req as any).on = vi.fn((event: string, handler: Function) => {
      if (event === "data") {
        handler(rawBody);
      }
      if (event === "end") {
        handler();
      }
      return req;
    });

    const res = makeRes();
    const handled = await handleMessengerWebhookRequest(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res._body).toBe("EVENT_RECEIVED");
  });
});
