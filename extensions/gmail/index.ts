import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { gmailPlugin } from "./src/channel.js";
import { setGmailRuntime } from "./src/runtime.js";

export { gmailPlugin } from "./src/channel.js";
export { setGmailRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "gmail",
  name: "Gmail",
  description: "Gmail channel plugin",
  plugin: gmailPlugin as ChannelPlugin,
  setRuntime: setGmailRuntime,
});
