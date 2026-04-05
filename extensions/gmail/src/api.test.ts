import { describe, expect, it } from "vitest";
import { parseGmailMessage } from "./api.js";

describe("parseGmailMessage", () => {
  it("parses a simple plain-text message", () => {
    const msg = {
      id: "msg-1",
      threadId: "thread-1",
      internalDate: "1700000000000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "sender@example.com" },
          { name: "To", value: "me@example.com" },
          { name: "Subject", value: "Test Subject" },
          { name: "Message-ID", value: "<abc@mail.example.com>" },
        ],
        body: {
          data: Buffer.from("Hello, world!").toString("base64url"),
        },
      },
    };

    const result = parseGmailMessage(msg);

    expect(result.from).toBe("sender@example.com");
    expect(result.to).toEqual(["me@example.com"]);
    expect(result.subject).toBe("Test Subject");
    expect(result.body).toBe("Hello, world!");
    expect(result.threadId).toBe("thread-1");
    expect(result.gmailMessageId).toBe("msg-1");
    expect(result.isReply).toBe(false);
  });

  it("parses a multipart message preferring text/plain", () => {
    const msg = {
      id: "msg-2",
      threadId: "thread-2",
      internalDate: "1700000000000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Name <sender@test.com>" },
          { name: "To", value: "a@test.com, b@test.com" },
          { name: "Subject", value: "Multi" },
          { name: "Message-ID", value: "<def@mail.test.com>" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Plain text body").toString("base64url"),
            },
          },
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from("<p>HTML body</p>").toString("base64url"),
            },
          },
        ],
      },
    };

    const result = parseGmailMessage(msg);

    expect(result.from).toBe("sender@test.com");
    expect(result.to).toEqual(["a@test.com", "b@test.com"]);
    expect(result.body).toBe("Plain text body");
  });

  it("detects a reply via In-Reply-To header", () => {
    const msg = {
      id: "msg-3",
      threadId: "thread-1",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "sender@test.com" },
          { name: "To", value: "me@test.com" },
          { name: "Subject", value: "Re: Test" },
          { name: "Message-ID", value: "<ghi@mail.test.com>" },
          { name: "In-Reply-To", value: "<abc@mail.test.com>" },
        ],
        body: {
          data: Buffer.from("Reply body").toString("base64url"),
        },
      },
    };

    const result = parseGmailMessage(msg);

    expect(result.isReply).toBe(true);
    expect(result.inReplyTo).toBe("<abc@mail.test.com>");
  });

  it("falls back to HTML when no plain text part exists", () => {
    const msg = {
      id: "msg-4",
      threadId: "thread-4",
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "From", value: "sender@test.com" },
          { name: "To", value: "me@test.com" },
          { name: "Subject", value: "HTML Only" },
          { name: "Message-ID", value: "<jkl@mail.test.com>" },
        ],
        body: {
          data: Buffer.from("<p>Hello</p><br/><p>World</p>").toString("base64url"),
        },
      },
    };

    const result = parseGmailMessage(msg);

    expect(result.body).toContain("Hello");
    expect(result.body).toContain("World");
  });

  it("extracts attachments", () => {
    const msg = {
      id: "msg-5",
      threadId: "thread-5",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "sender@test.com" },
          { name: "To", value: "me@test.com" },
          { name: "Subject", value: "With Attachment" },
          { name: "Message-ID", value: "<mno@mail.test.com>" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("See attached").toString("base64url"),
            },
          },
          {
            mimeType: "application/pdf",
            filename: "document.pdf",
            body: {
              attachmentId: "att-1",
              size: 12345,
            },
          },
        ],
      },
    };

    const result = parseGmailMessage(msg);

    expect(result.body).toBe("See attached");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      filename: "document.pdf",
      mimeType: "application/pdf",
      size: 12345,
      attachmentId: "att-1",
    });
  });

  it("extracts Cc recipients", () => {
    const msg = {
      id: "msg-6",
      threadId: "thread-6",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "sender@test.com" },
          { name: "To", value: "me@test.com" },
          { name: "Cc", value: "cc1@test.com, cc2@test.com" },
          { name: "Subject", value: "With CC" },
          { name: "Message-ID", value: "<pqr@mail.test.com>" },
        ],
        body: {
          data: Buffer.from("Body").toString("base64url"),
        },
      },
    };

    const result = parseGmailMessage(msg);

    expect(result.cc).toEqual(["cc1@test.com", "cc2@test.com"]);
  });
});
