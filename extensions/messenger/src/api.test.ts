import { describe, expect, it } from "vitest";
import { parseMessengerMessage, type MessengerWebhookMessaging } from "./api.js";

describe("parseMessengerMessage", () => {
  it("parses a text message", () => {
    const entry: MessengerWebhookMessaging = {
      sender: { id: "123456" },
      recipient: { id: "789012" },
      timestamp: 1700000000000,
      message: {
        mid: "mid.test123",
        text: "Hello, bot!",
      },
    };

    const result = parseMessengerMessage(entry);
    expect(result).not.toBeNull();
    expect(result!.senderId).toBe("123456");
    expect(result!.recipientId).toBe("789012");
    expect(result!.timestamp).toBe(1700000000000);
    expect(result!.messageId).toBe("mid.test123");
    expect(result!.text).toBe("Hello, bot!");
  });

  it("parses a message with attachments", () => {
    const entry: MessengerWebhookMessaging = {
      sender: { id: "123456" },
      recipient: { id: "789012" },
      timestamp: 1700000000000,
      message: {
        mid: "mid.test456",
        text: "",
        attachments: [
          {
            type: "image",
            payload: { url: "https://example.com/photo.jpg" },
          },
        ],
      },
    };

    const result = parseMessengerMessage(entry);
    expect(result).not.toBeNull();
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]!.type).toBe("image");
    expect(result!.attachments![0]!.url).toBe("https://example.com/photo.jpg");
  });

  it("returns null for non-message events (e.g. postback only)", () => {
    const entry: MessengerWebhookMessaging = {
      sender: { id: "123456" },
      recipient: { id: "789012" },
      timestamp: 1700000000000,
      postback: {
        title: "Get Started",
        payload: "GET_STARTED",
      },
    };

    const result = parseMessengerMessage(entry);
    expect(result).toBeNull();
  });

  it("handles message without text", () => {
    const entry: MessengerWebhookMessaging = {
      sender: { id: "123456" },
      recipient: { id: "789012" },
      timestamp: 1700000000000,
      message: {
        mid: "mid.notext",
      },
    };

    const result = parseMessengerMessage(entry);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("");
  });
});
