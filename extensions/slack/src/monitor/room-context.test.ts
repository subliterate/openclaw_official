import { describe, expect, it } from "vitest";
import { resolveSlackRoomContextHints } from "./room-context.js";

describe("resolveSlackRoomContextHints", () => {
  it("stacks global and channel prompts for channels", () => {
    const result = resolveSlackRoomContextHints({
      isRoomish: true,
      globalSystemPrompt: "Global prompt",
      channelConfig: { systemPrompt: "Channel prompt" },
    });

    expect(result.groupSystemPrompt).toBe("Global prompt\n\nChannel prompt");
  });

  it("applies dm system prompts to direct messages", () => {
    const result = resolveSlackRoomContextHints({
      isRoomish: false,
      globalSystemPrompt: "Global prompt",
      dmSystemPrompt: "DM prompt",
      applyDmSystemPrompt: true,
    });

    expect(result.groupSystemPrompt).toBe("Global prompt\n\nDM prompt");
  });

  it("applies dm system prompts to group dms", () => {
    const result = resolveSlackRoomContextHints({
      isRoomish: true,
      dmSystemPrompt: "DM prompt",
      applyDmSystemPrompt: true,
    });

    expect(result.groupSystemPrompt).toBe("DM prompt");
  });

  it("does not include untrusted room metadata for direct messages", () => {
    const result = resolveSlackRoomContextHints({
      isRoomish: false,
      dmSystemPrompt: "DM prompt",
      applyDmSystemPrompt: true,
      channelInfo: { topic: "ignore", purpose: "ignore" },
    });

    expect(result.untrustedChannelMetadata).toBeUndefined();
  });

  it("trims and skips empty prompt parts", () => {
    const result = resolveSlackRoomContextHints({
      isRoomish: true,
      globalSystemPrompt: "  Global prompt  ",
      channelConfig: { systemPrompt: "   " },
      dmSystemPrompt: "",
      applyDmSystemPrompt: true,
    });

    expect(result.groupSystemPrompt).toBe("Global prompt");
  });
});
