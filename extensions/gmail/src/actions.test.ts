import { describe, expect, it, vi, beforeEach } from "vitest";
import { gmailActionSearch, gmailActionRead, gmailActionChannelList } from "./actions.js";

vi.mock("./accounts.js", () => ({
  resolveGmailAccount: vi.fn(({ cfg, accountId }) => {
    const config = cfg?.channels?.gmail ?? {};
    return {
      accountId: accountId ?? "default",
      enabled: config.enabled !== false,
      configured: Boolean(config.clientId && config.clientSecret && config.refreshToken),
      email: "test@example.com",
      clientId: config.clientId ?? "",
      clientSecret: config.clientSecret ?? "",
      refreshToken: config.refreshToken ?? "",
      config,
    };
  }),
}));

vi.mock("./api.js", () => ({
  listMessages: vi.fn().mockResolvedValue([
    { id: "msg-1", threadId: "thread-1" },
    { id: "msg-2", threadId: "thread-2" },
  ]),
  getMessage: vi.fn().mockImplementation((_account, messageId: string) =>
    Promise.resolve({
      gmailMessageId: messageId,
      threadId: `thread-${messageId}`,
      from: "sender@example.com",
      to: ["me@example.com"],
      cc: [],
      subject: `Subject for ${messageId}`,
      body: `Body of message ${messageId}`,
      timestamp: 1700000000000,
      isReply: false,
      attachments: [],
    }),
  ),
  listLabels: vi.fn().mockResolvedValue([
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "SENT", name: "SENT", type: "system" },
    { id: "TRASH", name: "TRASH", type: "system" },
    { id: "CATEGORY_PROMOTIONS", name: "CATEGORY_PROMOTIONS", type: "system" },
    { id: "Label_1", name: "Work", type: "user" },
    { id: "Label_2", name: "Personal", type: "user" },
  ]),
}));

const CONFIGURED_CFG = {
  channels: {
    gmail: {
      enabled: true,
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      refreshToken: "test-refresh-token",
    },
  },
};

describe("gmail actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("search", () => {
    it("searches messages and returns formatted results", async () => {
      const result = await gmailActionSearch(CONFIGURED_CFG as any, {
        query: "from:boss@co.com",
        limit: 5,
      });

      const { listMessages } = await import("./api.js");
      expect(listMessages).toHaveBeenCalledWith(expect.objectContaining({ accountId: "default" }), {
        query: "from:boss@co.com",
        maxResults: 5,
      });

      expect(result.details).toEqual(
        expect.objectContaining({
          ok: true,
          count: 2,
          results: expect.arrayContaining([
            expect.objectContaining({ id: "msg-1", from: "sender@example.com" }),
            expect.objectContaining({ id: "msg-2", from: "sender@example.com" }),
          ]),
        }),
      );
    });

    it("defaults limit to 10", async () => {
      await gmailActionSearch(CONFIGURED_CFG as any, { query: "invoices" });

      const { listMessages } = await import("./api.js");
      expect(listMessages).toHaveBeenCalledWith(expect.anything(), {
        query: "invoices",
        maxResults: 10,
      });
    });
  });

  describe("read", () => {
    it("reads a single message by ID", async () => {
      const result = await gmailActionRead(CONFIGURED_CFG as any, { messageId: "msg-42" });

      const { getMessage } = await import("./api.js");
      expect(getMessage).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: "default" }),
        "msg-42",
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          ok: true,
          message: expect.objectContaining({
            id: "msg-42",
            from: "sender@example.com",
            subject: "Subject for msg-42",
            body: "Body of message msg-42",
          }),
        }),
      );
    });
  });

  describe("channel-list", () => {
    it("returns filtered labels", async () => {
      const result = await gmailActionChannelList(CONFIGURED_CFG as any);

      expect(result.details).toEqual(
        expect.objectContaining({
          ok: true,
          labels: expect.arrayContaining([
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "SENT", name: "SENT", type: "system" },
            { id: "Label_1", name: "Work", type: "user" },
            { id: "Label_2", name: "Personal", type: "user" },
          ]),
        }),
      );

      // CATEGORY_PROMOTIONS is a system label not in the visible set
      const labels = (result.details as any).labels;
      expect(labels.find((l: any) => l.id === "CATEGORY_PROMOTIONS")).toBeUndefined();
    });
  });
});
